import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { redlock } from '../config/redis';
import { buildExpiresAt } from '../config/order';
import { invalidateEventCache } from '../utils/cache';
import { AppError, handleControllerError, logUnexpectedError } from '../utils/errors';
import { exceedsOrderAmount } from '../utils/validation';

export const createOrder = async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { ticketTypeId, quantity } = req.body;

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
      const reserved = await tx.ticketType.updateMany({
        where: { id: ticketTypeId, availableQuantity: { gte: quantity } },
        data: {
          availableQuantity: {
            decrement: quantity,
          },
        },
      });

      // count === 0 nghĩa là KHÔNG còn đủ vé tại thời điểm ghi,
      // chứ không phải tại thời điểm đọc.
      if (reserved.count === 0) {
        const current = await tx.ticketType.findUnique({
          where: { id: ticketTypeId },
          select: { availableQuantity: true },
        });

        if (!current) {
          throw new AppError('Loại vé không tồn tại!');
        }

        // AppError chứ không phải Error: câu này được viết để người dùng đọc,
        // nên nó là loại DUY NHẤT được phép ra client nguyên văn.
        throw new AppError(`Rất tiếc, chỉ còn lại ${current.availableQuantity} vé!`);
      }

      // Đọc lại SAU khi đã khoá row để lấy giá/eventId khớp với phiên bản đã ghi
      const ticketType = await tx.ticketType.findUnique({
        where: { id: ticketTypeId },
      });

      if (!ticketType) {
        throw new AppError('Loại vé không tồn tại!');
      }

      const totalAmount = ticketType.price.toNumber() * quantity;

      // Ràng buộc invariant của cột `orders.totalAmount` (DECIMAL(12,2)).
      //
      // Việc kiểm tra `price * totalQuantity` ở tầng tạo/sửa sự kiện chỉ bảo vệ
      // lúc đó; giá vé có thể được sửa sau, nên đường đặt vé phải tự kiểm lại.
      // Thiếu bước này thì lỗi chỉ lộ ra ở tầng Prisma (P2020) với thông báo
      // khó hiểu, thay vì nói rõ ngay cho người mua biết đơn vượt giới hạn.
      if (exceedsOrderAmount(ticketType.price.toNumber(), quantity)) {
        throw new AppError('Tổng tiền của đơn hàng vượt quá giới hạn cho phép!');
      }

      const order = await tx.order.create({
        data: {
          userId,
          totalAmount,
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

export const MYOrders = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        tickets: {
          include: {
            ticketType: {
              include: {
                event: {
                  select: { title: true, startTime: true, location: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(orders);
  } catch (error) {
    return handleControllerError(res, 'MYOrders', error);
  }
};