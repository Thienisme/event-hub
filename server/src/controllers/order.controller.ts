import { Request, Response } from 'express';
import { Prisma, OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { notifyWaitlist, returnedQuantities } from '../utils/waitlistNotify';
import { redlock } from '../config/redis';
import { markOrderConfirmed, emailConfirmedOrder } from '../payments/complete';
import {
  buildExpiresAt,
  isSimulatedPaymentEnabled,
  MAX_TICKETS_PER_USER_PER_EVENT,
} from '../config/order';
import { claimPromoUsage, releasePromoUsage, returnTicketsToStock } from '../utils/orderInventory';
import { invalidateEventCache } from '../utils/cache';
import { AppError, handleControllerError, logUnexpectedError } from '../utils/errors';
import { exceedsOrderAmount } from '../utils/validation';
import { applicablePromo, computeDiscount, publicOfferWhere, hasRemainingUses, publicOffer } from '../utils/promo';
import { parsePagination } from '../utils/pagination';

/** Đơn đang chiếm vé trong kho. Đơn EXPIRED và CANCELLED đã trả vé nên không tính. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED'];

const ORDER_INCLUDE = { tickets: true } as const;

export const createOrder = async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { ticketTypeId, quantity, promoCode } = req.body;

  if (!userId) {
    return res.status(401).json({ message: 'Người dùng chưa đăng nhập!' });
  }

  if (!ticketTypeId || !quantity || quantity <= 0) {
    return res.status(400).json({ message: 'Thông tin loại vé hoặc số lượng không hợp lệ!' });
  }

  const lockKey = `locks:ticketType:${ticketTypeId}`;
  const ttl = 5000; // Giữ lock tối đa 5 giây

  let lock;
  try {
    // 1. Acquire Distributed Lock
    lock = await redlock.acquire([lockKey], ttl);

    // 2. Thực thi Prisma Transaction
    const result = await prisma.$transaction(async (tx) => {
      // Hạn mức theo tài khoản. Phải khoá dòng user TRƯỚC khi đọc gì khác:
      // Redlock khoá theo loại vé nên không xếp hàng được các đơn của cùng một người
      // ở nhiều loại vé. Câu này cũng phải là câu đầu tiên của transaction, vì
      // REPEATABLE READ chụp snapshot ở lần đọc thường đầu tiên; đọc trước khi có
      // khoá thì `count` bên dưới không thấy đơn vừa commit và hạn mức bị vượt.
      await tx.$queryRaw`SELECT id FROM \`users\` WHERE id = ${userId} FOR UPDATE`;

      const target = await tx.ticketType.findUnique({
        where: { id: ticketTypeId },
        select: { eventId: true },
      });

      if (target) {
        const heldTickets = await tx.ticket.count({
          where: {
            ticketType: { eventId: target.eventId },
            order: { userId, status: { in: ACTIVE_ORDER_STATUSES } },
          },
        });

        if (heldTickets + quantity > MAX_TICKETS_PER_USER_PER_EVENT) {
          throw new AppError(
            `Mỗi tài khoản chỉ được giữ tối đa ${MAX_TICKETS_PER_USER_PER_EVENT} vé cho một sự kiện, bạn đang có ${heldTickets} vé!`
          );
        }
      }

      // CHỐT CHẶN THẬT NẰM Ở ĐÂY.
      //
      // Trước đây là: findUnique() -> if (availableQuantity < quantity) throw -> update(decrement).
      // Đó là read-then-write: hai request cùng đọc thấy 1 vé rồi cùng trừ,
      // kết quả -1. Cách viết đó chỉ an toàn NHỜ lock bên ngoài.
      //
      // Điều kiện "còn đủ vé" được đưa xuống thẳng câu UPDATE, nên MySQL
      // kiểm tra và trừ trong CÙNG một câu lệnh, trên row đã bị khoá:
      // request thứ hai bị block, và khi được chạy thì điều kiện WHERE
      // được đánh giá lại trên dữ liệu ĐÃ COMMIT của request thứ nhất.
      // Đây là compare-and-swap: khoá row là cơ chế, không phải mẹo.
      const saleNow = new Date();
      const reserved = await tx.ticketType.updateMany({
        where: { id: ticketTypeId, availableQuantity: { gte: quantity }, AND: [
          { OR: [{ saleStart: null }, { saleStart: { lte: saleNow } }] },
          { OR: [{ saleEnd: null }, { saleEnd: { gt: saleNow } }] },
        ] },
        data: {
          availableQuantity: {
            decrement: quantity,
          },
        },
      });

      // Đọc có khoá để lấy phiên bản hiện tại, tránh snapshot REPEATABLE READ
      // cũ nếu ban tổ chức vừa sửa thời gian bán trong lúc request chờ giữ vé.
      if (reserved.count === 0) {
        const [current] = await tx.$queryRaw<Array<{
          availableQuantity: number; saleStart: Date | null; saleEnd: Date | null;
        }>>`SELECT availableQuantity, saleStart, saleEnd FROM ticket_types WHERE id = ${ticketTypeId} FOR UPDATE`;

        if (!current) {
          throw new AppError('Loại vé không tồn tại!');
        }

        if (current.saleStart && current.saleStart > saleNow) {
          throw new AppError('Loại vé này chưa mở bán!', 409, { saleStart: current.saleStart });
        }
        if (current.saleEnd && current.saleEnd <= saleNow) throw new AppError('Loại vé này đã ngừng bán!', 409);

        // AppError chứ không phải Error: câu này được viết để người dùng đọc,
        // nên nó là loại DUY NHẤT được phép ra client nguyên văn.
        throw new AppError(`Rất tiếc, chỉ còn lại ${current.availableQuantity} vé!`);
      }

      // Đọc lại SAU khi đã khoá row để lấy giá/eventId khớp với phiên bản đã ghi
      const ticketType = await tx.ticketType.findUnique({
        where: { id: ticketTypeId },
        include: { event: { select: { endTime: true } } },
      });

      if (!ticketType) {
        throw new AppError('Loại vé không tồn tại!');
      }

      // Ném lỗi ở đây là an toàn: transaction rollback nên số vé vừa trừ được trả lại.
      if (ticketType.event.endTime <= new Date()) {
        throw new AppError('Sự kiện đã kết thúc, không thể đặt vé!');
      }

      // Decimal.mul: giữ phép tính trong kiểu Decimal thay vì đổi sang double.
      // Giá vé có 2 chữ số thập phân; nhân bằng số thực có thể lệch ở biên và
      // ghi vào DECIMAL(12,2) một giá trị đã bị làm tròn ngầm.
      const subtotalAmount = ticketType.price.mul(quantity);

      // Ràng buộc invariant của cột `orders.totalAmount` (DECIMAL(12,2)).
      //
      // Việc kiểm tra `price * totalQuantity` ở tầng tạo/sửa sự kiện chỉ bảo vệ
      // lúc đó; giá vé có thể được sửa sau, nên đường đặt vé phải tự kiểm lại.
      // Thiếu bước này thì lỗi chỉ lộ ra ở tầng Prisma (P2020) với thông báo
      // khó hiểu, thay vì nói rõ ngay cho người mua biết đơn vượt giới hạn.
      if (exceedsOrderAmount(ticketType.price.toNumber(), quantity)) {
        throw new AppError('Tổng tiền của đơn hàng vượt quá giới hạn cho phép!');
      }

      const promo = promoCode ? await applicablePromo(tx, ticketType.eventId, promoCode, userId) : null;
      if (promo) await claimPromoUsage(tx, promo.id);
      const amounts = promo ? computeDiscount(subtotalAmount, promo)
        : { subtotalAmount, discountAmount: new Prisma.Decimal(0), totalAmount: subtotalAmount };
      const order = await tx.order.create({
        data: {
          userId,
          ...amounts,
          promoCodeId: promo?.id,
          status: 'PENDING',
          // Giữ chỗ có thời hạn: nếu quá hạn mà chưa thanh toán,
          // job nền (jobs/expireOrders.job.ts) sẽ chuyển EXPIRED và trả vé về kho.
          expiresAt: buildExpiresAt(),
          tickets: {
            create: Array.from({ length: quantity }).map(() => ({
              ticketTypeId,
            })),
          },
        },
        include: {
          tickets: true,
        },
      });

      return { order, eventId: ticketType.eventId };
    });

    void prisma.waitlistEntry.deleteMany({ where: { ticketTypeId, userId } })
      .catch(() => console.error('[waitlist] Không thể xoá người đã đặt vé'));

    // 3. Nhả lock NGAY khi transaction đã commit.
    //
    // Bước vô hiệu cache bên dưới KHÔNG cần lock: nó không đọc/ghi tồn kho, nên
    // giữ lock thêm chỉ làm dài hàng đợi của mọi người đang mua cùng loại vé.
    // Cache làm việc trên Redis còn lock cũng nằm trên Redis — giữ lock suốt lúc
    // gọi Redis là tự bỏ đi phần song song hoá vốn có.
    await lock.release().catch(() => {});
    lock = undefined;

    // 4. Vô hiệu cache để giao diện thấy số vé mới nhất (O(1), xem utils/cache.ts).
    await invalidateEventCache(result.eventId);

    return res.status(201).json({
      message: 'Đặt vé thành công!',
      order: result.order,
    });
  } catch (error: unknown) {
    // Redlock không lấy được lock trong thời gian cho phép -> coi là quá tải.
    // Vẫn phải log: nguyên nhân thật có thể là Redis chết chứ không phải
    // "nhiều người cùng mua", và thông báo 429 sẽ khiến ta chẩn đoán sai hướng.
    if (error instanceof Error && error.name === 'ExecutionError') {
      logUnexpectedError('createOrder:redlock', error);
      return res.status(429).json({
        message: 'Hệ thống đang quá tải do có nhiều người cùng mua vé, vui lòng thử lại!',
      });
    }

    // AppError (hết vé, loại vé không tồn tại) -> 400: lỗi thuộc về phía REQUEST,
    // client sửa được và không nên thử lại y nguyên.
    //
    // Mọi lỗi còn lại -> 500: server hỏng (Prisma timeout, mất kết nối DB, bug...).
    // Trước đây nhánh này cũng trả 400, nghĩa là khi DB quá tải, client được báo
    // "request của bạn sai" — sai hướng hoàn toàn: client không thử lại, và
    // monitoring không đếm được lỗi server vì nó lẫn vào nhóm 4xx.
    return handleControllerError(res, 'createOrder', error, {
      statusCode: 500,
      message: 'Đặt vé thất bại, vui lòng thử lại sau!',
    });
  } finally {
    // 5. Chốt an toàn: nếu code tới đây mà lock còn đang giữ (nhánh lỗi), nhả nốt.
    if (lock) {
      await lock.release().catch(() => {});
    }
  }
};

/**
 * Danh sách đơn của chính người dùng, có phân trang.
 *
 * Phân trang ở server vì một tài khoản có thể có rất nhiều đơn theo thời gian;
 * trả hết mọi đơn sẽ làm response phình dần. Cùng dạng với listAllEvents:
 * `{ message, data, pagination }`.
 */
export const MYOrders = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { page, limit, skip } = parsePagination(req.query);

    const where = { userId };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          tickets: {
            include: {
              ticketType: {
                include: {
                  event: {
                    select: { title: true, startTime: true, location: true, bannerUrl: true, slug: true, endTime: true, category: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return res.json({
      message: 'Lấy danh sách đơn hàng thành công!',
      data: orders,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleControllerError(res, 'MYOrders', error);
  }
};

/**
 * Xác nhận thanh toán (giả lập) và sinh mã QR cho từng vé.
 *
 * Đổi trạng thái bằng `updateMany` có điều kiện để loại trừ lẫn nhau với job hết
 * hạn và thao tác huỷ: chỉ một bên đổi được PENDING. Gọi lại khi đơn đã CONFIRMED
 * trả về đúng đơn đó, để client bấm lại hoặc thử lại sau lỗi mạng không bị báo lỗi.
 */
export const confirmOrder = async (req: Request, res: Response) => {
  if (!isSimulatedPaymentEnabled()) {
    return res.status(404).json({ message: 'Chức năng thanh toán giả lập không khả dụng!' });
  }

  const userId = req.user!.userId;
  const { id } = req.params;

  try {
    const { order, newlyConfirmed } = await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id, userId, status: 'PENDING', expiresAt: { gt: new Date() } },
          data: { status: 'CONFIRMED' },
        });

        if (claimed.count === 0) {
          const current = await tx.order.findFirst({
            where: { id, userId },
            include: ORDER_INCLUDE,
          });

          if (!current) throw new AppError('Không tìm thấy đơn hàng!', 404);
          if (current.status === 'CONFIRMED') return { order: current, newlyConfirmed: false };
          if (current.status === 'CANCELLED') {
            throw new AppError('Đơn hàng đã bị huỷ, không thể thanh toán!', 409);
          }
          throw new AppError('Đơn hàng đã hết hạn giữ chỗ, không thể thanh toán!', 409);
        }

        return {
          order: await markOrderConfirmed(tx, id),
          newlyConfirmed: true,
        };
      },
      // Một đơn có tới MAX_ORDER_QUANTITY vé, mỗi vé một câu UPDATE.
      { timeout: 15_000 }
    );

    // Transaction đã commit; gửi nền chỉ khi lần này thực sự đổi trạng thái.
    if (newlyConfirmed) emailConfirmedOrder(order.id);

    return res.json({ message: 'Thanh toán thành công!', order });
  } catch (error) {
    return handleControllerError(res, 'confirmOrder', error);
  }
};

/**
 * Huỷ đơn đang giữ chỗ và trả vé về kho.
 *
 * Chỉ huỷ được đơn PENDING: chưa có hoàn tiền nên đơn đã thanh toán không huỷ ở đây.
 * Gọi lại khi đơn đã CANCELLED không cộng vé lần nữa, vì `updateMany` trả `count = 0`.
 */
export const cancelOrder = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  try {
    const { order, eventIds, returned } = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, userId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      if (claimed.count === 0) {
        const current = await tx.order.findFirst({
          where: { id, userId },
          include: ORDER_INCLUDE,
        });

        if (!current) throw new AppError('Không tìm thấy đơn hàng!', 404);
        if (current.status === 'CANCELLED') return { order: current, eventIds: [], returned: [] };
        if (current.status === 'CONFIRMED') {
          throw new AppError('Đơn hàng đã thanh toán, không thể huỷ!', 409);
        }
        throw new AppError('Đơn hàng đã hết hạn giữ chỗ!', 409);
      }

      const updated = await tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
      const eventIds = await returnTicketsToStock(tx, updated.tickets);
      await releasePromoUsage(tx, updated);
      return { order: updated, eventIds, returned: returnedQuantities(updated.tickets) };
    });

    void notifyWaitlist(returned).catch(() => console.error('[waitlist] Lỗi báo vé trả lại'));
    if (eventIds.length > 0) await invalidateEventCache(eventIds);

    return res.json({ message: 'Đã huỷ đơn hàng!', order });
  } catch (error) {
    return handleControllerError(res, 'cancelOrder', error);
  }
};

/** Dữ liệu thanh toán không bao gồm chi tiết giao dịch của cổng. */
const CHECKOUT_INCLUDE = {
  tickets: { include: { ticketType: { include: {
    event: { select: { title: true, startTime: true, location: true, slug: true, bannerUrl: true, endTime: true, category: true } },
  } } } },
  promoCode: { select: { code: true } },
  _count: { select: { payments: true } },
} as const;

type CheckoutOrder = Prisma.OrderGetPayload<{ include: typeof CHECKOUT_INCLUDE }>;
function checkoutOrder(order: CheckoutOrder) {
  const { promoCode, _count, ...data } = order;
  return { ...data, promoCode: promoCode?.code ?? null, paymentStarted: _count.payments > 0 };
}

export const getOrder = async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, userId: req.user!.userId }, include: CHECKOUT_INCLUDE,
    });
    if (!order) throw new AppError('Không tìm thấy đơn hàng!', 404);
    return res.json({ message: 'Lấy đơn hàng thành công!', data: checkoutOrder(order) });
  } catch (error) {
    return handleControllerError(res, 'getOrder', error);
  }
};

/** Khoá tài khoản trước đơn để hạn mức theo tài khoản thấy các đơn vừa commit. */
async function changeOrderPromo(userId: string, id: string, code?: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id, userId }, include: CHECKOUT_INCLUDE });
    if (!order) throw new AppError('Không tìm thấy đơn hàng!', 404);
    const now = new Date();
    if (order.status !== 'PENDING' || !order.expiresAt || order.expiresAt <= now) {
      throw new AppError('Đơn hàng không còn chờ thanh toán hoặc đã hết hạn giữ chỗ!', 409);
    }
    if (order._count.payments > 0) {
      throw new AppError('Đơn đã bắt đầu thanh toán, không thể đổi mã giảm giá!', 409);
    }
    if (code ? order.promoCode?.code === code : !order.promoCodeId) return checkoutOrder(order);

    const eventId = order.tickets[0]?.ticketType.eventId;
    if (code && !eventId) throw new AppError('Đơn hàng không có vé để áp mã giảm giá!');
    const promo = code ? await applicablePromo(tx, eventId!, code, userId, now, id) : null;
    await releasePromoUsage(tx, order);
    if (promo) await claimPromoUsage(tx, promo.id);
    const amounts = promo ? computeDiscount(order.subtotalAmount, promo)
      : { totalAmount: order.subtotalAmount, discountAmount: new Prisma.Decimal(0) };
    const updated = await tx.order.update({
      where: { id }, data: { ...amounts, promoCodeId: promo?.id ?? null }, include: CHECKOUT_INCLUDE,
    });
    return checkoutOrder(updated);
  });
}

export const applyOrderPromo = async (req: Request, res: Response) => {
  try {
    const data = await changeOrderPromo(req.user!.userId, req.params.id, req.body.code);
    return res.json({ message: 'Áp mã giảm giá thành công!', data });
  } catch (error) {
    return handleControllerError(res, 'applyOrderPromo', error);
  }
};

export const removeOrderPromo = async (req: Request, res: Response) => {
  try {
    const data = await changeOrderPromo(req.user!.userId, req.params.id);
    return res.json({ message: 'Gỡ mã giảm giá thành công!', data });
  } catch (error) {
    return handleControllerError(res, 'removeOrderPromo', error);
  }
};

export const getOrderOffers = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const order = await prisma.order.findFirst({ where: { id: req.params.id, userId },
      include: { tickets: { include: { ticketType: true } } } });
    if (!order) throw new AppError('Không tìm thấy đơn hàng!', 404);
    const now = new Date();
    const eventId = order.tickets[0]?.ticketType.eventId;
    if (order.status !== 'PENDING' || !order.expiresAt || order.expiresAt <= now || !eventId) {
      return res.json({ data: [] });
    }
    const promos = (await prisma.promoCode.findMany({ where: publicOfferWhere(eventId, now) })).filter(hasRemainingUses);
    const usage = await prisma.order.groupBy({ by: ['promoCodeId'],
      where: { userId, id: { not: order.id }, status: { in: ['PENDING', 'CONFIRMED'] },
        promoCodeId: { in: promos.map(p => p.id) } }, _count: { _all: true } });
    const counts = new Map(usage.map(row => [row.promoCodeId, row._count._all]));
    const data = promos.filter(p => (counts.get(p.id) ?? 0) < p.perUserLimit)
      .map(p => ({ promo: p, discountAmount: computeDiscount(order.subtotalAmount, p).discountAmount }))
      .filter(p => p.discountAmount.gt(0))
      .sort((a, b) => b.discountAmount.comparedTo(a.discountAmount)
        || (a.promo.endsAt?.getTime() ?? Infinity) - (b.promo.endsAt?.getTime() ?? Infinity)
        || a.promo.code.localeCompare(b.promo.code))
      .slice(0, 10).map(p => ({ ...publicOffer(p.promo), discountAmount: p.discountAmount.toString() }));
    return res.json({ data });
  } catch (error) { return handleControllerError(res, 'getOrderOffers', error); }
};
