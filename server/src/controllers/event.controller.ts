import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import {
  cacheGetOrLoad,
  detailCacheKey,
  getListVersion,
  invalidateEventList,
  invalidateEventDetails,
  listCacheKey,
} from '../utils/cache';
import { parsePagination } from '../utils/pagination';

/** Giới hạn tham số của API danh sách công khai. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Thông tin nhà tổ chức được phép xuất hiện ở API CÔNG KHAI.
 * Không có email: người chưa đăng nhập không được thu thập email từ đây.
 */
const PUBLIC_ORGANIZER_SELECT = { id: true, fullName: true } as const;

/**
 * Xoá các đơn EXPIRED và CANCELLED đang tham chiếu tới những loại vé sắp bị xoá.
 *
 * Các đơn này đã trả vé về kho nhưng vẫn giữ dòng `Ticket` để người mua xem lại
 * lịch sử. Khoá ngoại tickets -> ticket_types là RESTRICT, nên nếu không dọn thì
 * mọi sự kiện từng có đơn hết hạn hoặc bị huỷ đều không xoá được.
 *
 * Tìm id trước rồi mới xoá: `deleteMany` với điều kiện quan hệ sinh câu truy vấn
 * mà MySQL từ chối (lỗi 1093). Đơn PENDING/CONFIRMED không bị đụng tới: khoá ngoại
 * vẫn chặn (P2003) và transaction của nơi gọi được rollback toàn bộ.
 */
const deleteReleasedOrdersOf = async (
  tx: Prisma.TransactionClient,
  ticketTypeIds: string[]
): Promise<void> => {
  if (ticketTypeIds.length === 0) return;

  const orders = await tx.order.findMany({
    where: { status: { in: ['EXPIRED', 'CANCELLED'] }, tickets: { some: { ticketTypeId: { in: ticketTypeIds } } } },
    select: { id: true },
  });

  if (orders.length > 0) {
    await tx.order.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  }
};

// 1. Tạo sự kiện mới
export const createEvent = async (req: Request, res: Response) => {
  try {
    const { title, description, location, bannerUrl, startTime, endTime, ticketTypes } = req.body;
    const organizerId = req.user?.userId;

    if (!organizerId) {
      return res.status(401).json({ message: 'Không xác định được thông tin người tạo!' });
    }

    if (!title || !location || !startTime || !endTime) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ các trường bắt buộc!' });
    }

    const newEvent = await prisma.event.create({
      data: {
        title,
        description,
        location,
        bannerUrl,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        organizerId,
        ticketTypes: ticketTypes && ticketTypes.length > 0 ? {
          create: ticketTypes.map((ticket: { name: string; price: number; totalQuantity: number }) => ({
            name: ticket.name,
            price: ticket.price,
            totalQuantity: ticket.totalQuantity,
            availableQuantity: ticket.totalQuantity,
          })),
        } : undefined,
      },
      include: {
        ticketTypes: true,
      },
    });

    // Vô hiệu cache danh sách khi có event mới.
    // Chỉ tăng version (O(1)) thay cho `KEYS events:list:*` (O(N) và chặn Redis).
    await invalidateEventList();

    return res.status(201).json({
      message: 'Tạo sự kiện thành công!',
      event: newEvent,
    });
  } catch (error) {
    return handleControllerError(res, 'createEvent', error);
  }
};

// 2. Lấy danh sách sự kiện (Có Redis Cache)
export const getEvents = async (req: Request, res: Response) => {
  try {
    // Đây là API công khai và các giá trị này còn nằm trong khoá cache, nên phải
    // giới hạn: không để một request tải cả bảng hay làm phình Redis.
    const { page, limit, skip } = parsePagination(req.query, 10);
    const search = String(req.query.search ?? '').trim().slice(0, MAX_SEARCH_LENGTH);

    // Khoá cache có kèm version: khi version tăng, mọi key cũ trở nên vô hình.
    const version = await getListVersion();
    const status = req.query.status === 'ended' ? 'ended' : 'upcoming';
    const cacheKey = listCacheKey(version, page, limit, search, status);

    // cacheGetOrLoad lo cả ba việc: đọc cache, chống stampede, và cho biết dữ liệu
    // đến từ đâu ('cache' | 'database') — vừa để FE biết, vừa để đo hit rate.
    const { value: result, source } = await cacheGetOrLoad(cacheKey, async () => {
      const now = new Date();
      const whereCondition: Prisma.EventWhereInput = {
        AND: [
          { endTime: status === 'ended' ? { lt: now } : { gte: now } },
          ...(search
            ? [{ OR: [{ title: { contains: search } }, { location: { contains: search } }] }]
            : []),
        ],
      };

      const [events, total] = await Promise.all([
        prisma.event.findMany({
          where: whereCondition,
          skip,
          take: limit,
          orderBy: [{ startTime: status === 'ended' ? 'desc' : 'asc' }, { id: 'asc' }],
          include: {
            organizer: { select: PUBLIC_ORGANIZER_SELECT },
            ticketTypes: true,
          },
        }),
        prisma.event.count({ where: whereCondition }),
      ]);

      return {
        data: events,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });

    return res.json({
      source,
      ...result,
    });
  } catch (error) {
    return handleControllerError(res, 'getEvents', error);
  }
};

// 3. Lấy chi tiết 1 sự kiện (Có Redis Cache)
export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // `T` là `Event | null` vì sự kiện có thể không tồn tại. Giá trị null sẽ
    // không được ghi vào cache (xem cacheGetOrLoad).
    const { value: event, source } = await cacheGetOrLoad(
      detailCacheKey(id),
      () =>
        prisma.event.findUnique({
          where: { id },
          include: {
            organizer: { select: PUBLIC_ORGANIZER_SELECT },
            ticketTypes: true,
          },
        })
    );

    if (!event) {
      return res.status(404).json({ message: 'Không tìm thấy sự kiện!' });
    }

    return res.json({
      source,
      data: event,
    });
  } catch (error) {
    return handleControllerError(res, 'getEventById', error);
  }
};

// 4. Cập nhật sự kiện
export const updateEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, location, bannerUrl, startTime, endTime } = req.body;

    // `undefined` (client không gửi) = KHÔNG đụng tới loại vé.
    // Mảng rỗng `[]` = người dùng đã xoá hết loại vé -> reconcile thật sự.
    // Phân biệt hai ý này là điều kiện để không "xoá oan" khi sửa mỗi tiêu đề.
    const ticketTypesInput:
      | Array<{ id?: string; name: string; price: number; totalQuantity: number }>
      | undefined = req.body.ticketTypes;

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Không xác định được thông tin người dùng!' });
    }

    const existingEvent = await prisma.event.findUnique({
      where: { id },
      include: { ticketTypes: true },
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Không tìm thấy sự kiện!' });
    }

    // Chỉ organizer của sự kiện hoặc admin mới được sửa.
    // Dùng `currentRole` (đọc từ DB) chứ không phải `role` trong JWT: token có
    // thể đã cũ sau khi admin bị hạ quyền.
    if (existingEvent.organizerId !== userId && req.user?.currentRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Bạn không có quyền sửa sự kiện này!' });
    }

    // Bước 1: phân loại yêu cầu thành 3 nhóm rõ ràng dựa trên ID.
    // Match theo ID (không theo index) vì thứ tự mảng không được đảm bảo.
    type UpdatePlan = {
      id: string;
      name: string;
      price: number;
      totalQuantity: number;
      oldTotal: number;
      delta: number;
    };

    const updates: UpdatePlan[] = [];
    const creates: Array<{ name: string; price: number; totalQuantity: number }> = [];
    const deletes: string[] = [];

    if (ticketTypesInput !== undefined) {
      const existingById = new Map(existingEvent.ticketTypes.map((t) => [t.id, t]));
      const seenIds = new Set<string>();

      for (const input of ticketTypesInput) {
        if (input.id) {
          const current = existingById.get(input.id);

          // ID không thuộc sự kiện này -> chặn ngay, tránh sửa dữ liệu event khác.
          if (!current) {
            return res.status(400).json({
              message: 'Loại vé không thuộc sự kiện này!',
            });
          }

          if (seenIds.has(input.id)) {
            return res.status(400).json({
              message: `Loại vé "${input.name}" bị gửi trùng trong yêu cầu!`,
            });
          }
          seenIds.add(input.id);

          const sold = current.totalQuantity - current.availableQuantity;
          if (input.totalQuantity < sold) {
            return res.status(400).json({
              message: `Số lượng vé "${input.name}" không được giảm xuống dưới ${sold} (số vé đã bán)!`,
            });
          }

          updates.push({
            id: input.id,
            name: input.name,
            price: input.price,
            totalQuantity: input.totalQuantity,
            oldTotal: current.totalQuantity,
            delta: input.totalQuantity - current.totalQuantity,
          });
        } else {
          creates.push({
            name: input.name,
            price: input.price,
            totalQuantity: input.totalQuantity,
          });
        }
      }

      // Loại vé cũ không còn trong input -> chỉ được xoá nếu chưa bán vé nào.
      for (const current of existingEvent.ticketTypes) {
        if (seenIds.has(current.id)) continue;

        const sold = current.totalQuantity - current.availableQuantity;
        if (sold > 0) {
          return res.status(400).json({
            message: `Không thể xoá loại vé "${current.name}" vì đã có ${sold} vé được bán!`,
          });
        }
        deletes.push(current.id);
      }
    }

    // Bước 2: ghi tất cả trong MỘT transaction.
    // dùng `increment delta` thay vì gán `availableQuantity` tuyệt đối:
    // nếu có người mua chen giữa lúc đọc và lúc ghi, phép cộng vẫn đúng
    // (available = total - sold), còn gán tuyệt đối sẽ ghi đè mất lượt mua đó.
    const updatedEvent = await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id },
        data: {
          title,
          description,
          location,
          bannerUrl,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        },
      });

      for (const plan of updates) {
        const result = await tx.ticketType.updateMany({
          where: {
            id: plan.id,
            eventId: id,
            // Optimistic concurrency: totalQuantity phải còn đúng như lúc đọc.
            totalQuantity: plan.oldTotal,
            // Nếu thu hẹp tổng, đảm bảo không kéo tồn kho xuống âm.
            ...(plan.delta < 0 ? { availableQuantity: { gte: -plan.delta } } : {}),
          },
          data: {
            name: plan.name,
            price: plan.price,
            totalQuantity: plan.totalQuantity,
            availableQuantity: { increment: plan.delta },
          },
        });

        if (result.count === 0) {
          throw new AppError(
            'Loại vé vừa được thay đổi bởi thao tác khác, vui lòng tải lại và thử lại!'
          );
        }
      }

      if (deletes.length > 0) {
        await deleteReleasedOrdersOf(tx, deletes);
        await tx.ticketType.deleteMany({
          where: { id: { in: deletes }, eventId: id },
        });
      }

      if (creates.length > 0) {
        await tx.ticketType.createMany({
          data: creates.map((ticket) => ({
            eventId: id,
            name: ticket.name,
            price: ticket.price,
            totalQuantity: ticket.totalQuantity,
            availableQuantity: ticket.totalQuantity,
          })),
        });
      }

      return tx.event.findUniqueOrThrow({
        where: { id },
        include: {
          ticketTypes: true,
          organizer: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });
    });

    // Vô hiệu cache chi tiết và danh sách
    await Promise.all([invalidateEventDetails(id), invalidateEventList()]);

    return res.json({
      message: 'Cập nhật sự kiện thành công!',
      event: updatedEvent,
    });
  } catch (error: any) {
    // Lưới an toàn cuối: FK RESTRICT của tickets -> ticket_types.
    if (error?.code === 'P2003') {
      return res.status(400).json({ message: 'Không thể xóa loại vé đã có người mua!' });
    }
    return handleControllerError(res, 'updateEvent', error);
  }
};

// 5. Xóa sự kiện
export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Không xác định được thông tin người dùng!' });
    }

    // Kiểm tra sự kiện tồn tại
    const existingEvent = await prisma.event.findUnique({
      where: { id },
      include: { ticketTypes: { select: { id: true } } },
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Không tìm thấy sự kiện!' });
    }

    // Chỉ organizer của sự kiện hoặc admin mới được xóa.
    // Dùng `currentRole` (đọc từ DB) chứ không phải `role` trong JWT.
    if (existingEvent.organizerId !== userId && req.user?.currentRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Bạn không có quyền xóa sự kiện này!' });
    }

    // Xóa sự kiện (cascade xóa ticket types), kèm các đơn đã hết hạn hoặc bị huỷ của nó.
    // Còn đơn PENDING/CONFIRMED thì FK RESTRICT giữ lại -> P2003 -> rollback cả
    // transaction, nên các đơn đó cũng không bị xoá oan.
    await prisma.$transaction(async (tx) => {
      await deleteReleasedOrdersOf(
        tx,
        existingEvent.ticketTypes.map((ticketType) => ticketType.id)
      );
      await tx.event.delete({ where: { id } });
    });

    // Vô hiệu cache
    await Promise.all([invalidateEventDetails(id), invalidateEventList()]);

    return res.json({
      message: 'Xóa sự kiện thành công!',
    });
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(400).json({
        message: 'Không thể xóa sự kiện vì đang có đơn giữ chỗ hoặc vé đã bán!',
      });
    }
    return handleControllerError(res, 'deleteEvent', error);
  }
};