import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { handleControllerError } from '../utils/errors';

/**
 * Danh sách sự kiện CỦA TÔI (organizer đang đăng nhập).
 *
 * Không dùng chung endpoint /api/events vì:
 * - endpoint đó là public và không lọc theo người gọi;
 * - ở đây cần thêm số vé đã bán, doanh thu — thứ mà bảng công khai không cần.
 */
export const listMyEvents = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const search = String(req.query.search ?? '').trim();

    const where = {
      organizerId: userId,
      ...(search
        ? { OR: [{ title: { contains: search } }, { location: { contains: search } }] }
        : {}),
    };

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          location: true,
          startTime: true,
          endTime: true,
          createdAt: true,
          ticketTypes: {
            select: {
              id: true,
              name: true,
              price: true,
              totalQuantity: true,
              availableQuantity: true,
            },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    return res.json({
      message: 'Lấy danh sách sự kiện của bạn thành công!',
      data: events,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleControllerError(res, 'organizer.listMyEvents', error);
  }
};

/**
 * Thống kê của organizer: bao nhiêu sự kiện, bán được bao nhiêu vé, thu được bao
 * nhiêu tiền.
 *
 * Doanh thu chỉ tính đơn CONFIRMED — đơn PENDING là vé đang giữ chỗ, chưa thu
 * được tiền; EXPIRED/CANCELLED thì không tính.
 */
export const getOrganizerStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const [eventCount, ticketTypeAgg, orderAgg, upcoming] = await Promise.all([
      prisma.event.count({ where: { organizerId: userId } }),
      prisma.ticketType.aggregate({
        where: { event: { organizerId: userId } },
        _sum: { totalQuantity: true, availableQuantity: true },
      }),
      prisma.order.aggregate({
        where: { status: 'CONFIRMED', tickets: { some: { ticketType: { event: { organizerId: userId } } } } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.event.count({
        where: { organizerId: userId, startTime: { gte: new Date() } },
      }),
    ]);

    const totalQuantity = ticketTypeAgg._sum.totalQuantity ?? 0;
    const availableQuantity = ticketTypeAgg._sum.availableQuantity ?? 0;

    return res.json({
      message: 'Lấy thống kê thành công!',
      data: {
        events: eventCount,
        upcomingEvents: upcoming,
        totalTickets: totalQuantity,
        soldTickets: Math.max(0, totalQuantity - availableQuantity),
        confirmedOrders: orderAgg._count._all,
        revenue: orderAgg._sum.totalAmount ?? 0,
      },
    });
  } catch (error) {
    return handleControllerError(res, 'organizer.getStats', error);
  }
};
