import { EventCategory, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';

/**
 * GET /api/organizer/dashboard?eventId=&days=7|30|90
 *
 * Bảng điều khiển bán vé của nhà tổ chức đang đăng nhập (ADMIN cũng chỉ thấy sự
 * kiện của chính mình, giống /organizer/events). Không truyền eventId = gộp mọi
 * sự kiện; eventId không phải của mình trả 404 như sự kiện không tồn tại.
 *
 * Quy ước số liệu:
 * - Chỉ tính đơn CONFIRMED. PENDING là vé đang giữ chỗ, chưa thu tiền.
 * - Doanh thu là `orders.totalAmount` (sau giảm giá). Doanh thu theo loại vé chia
 *   đều tổng tiền của đơn cho từng vé trong đơn; hiện mỗi đơn chỉ có một loại vé
 *   nên con số là chính xác. Khi cho mua nhiều loại vé một đơn cần xem lại.
 * - "Ngày" là ngày đặt đơn (`orders.createdAt`) theo giờ Việt Nam (UTC+7, không
 *   có giờ mùa hè), tính bằng DATE_ADD trong SQL nên chạy được cả MySQL lẫn TiDB
 *   mà không cần bảng múi giờ.
 * - `period`: so sánh kỳ hiện tại (`current`, tổng `days` ngày trong `daily`) với
 *   kỳ liền trước cùng độ dài (`previous`, ngay trước mốc bắt đầu của `daily`)
 *   theo ngày đặt đơn giờ Việt Nam.
 * - `byCategory`: doanh thu và số vé bán toàn thời gian gom theo danh mục sự kiện
 *   (`events.category`), sắp theo doanh thu giảm dần và bỏ danh mục không có phát sinh.
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DASHBOARD_RANGES = [7, 30, 90] as const;

/** Ngày YYYY-MM-DD theo giờ Việt Nam của một thời điểm. */
const vnDate = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);

const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

export const getSalesDashboard = async (req: Request, res: Response) => {
  try {
    const organizerId = req.user!.userId;
    const daysParam = Number(req.query.days);
    const days = (DASHBOARD_RANGES as readonly number[]).includes(daysParam) ? daysParam : 30;
    const eventIdParam = typeof req.query.eventId === 'string' && req.query.eventId.trim() ? req.query.eventId.trim() : null;

    const events = await prisma.event.findMany({
      where: { organizerId },
      orderBy: [{ startTime: 'desc' }, { id: 'asc' }],
      select: { id: true, title: true, category: true, startTime: true, endTime: true },
    });
    if (eventIdParam && !events.some((e) => e.id === eventIdParam)) {
      throw new AppError('Không tìm thấy sự kiện!', 404);
    }

    // Khoảng ngày: từ 0h (giờ VN) của ngày đầu tới hết hôm nay.
    const now = Date.now();
    const today = vnDate(now);
    const startMs = Date.parse(`${today}T00:00:00Z`) - VN_OFFSET_MS - (days - 1) * DAY_MS;
    const prevStartMs = startMs - days * DAY_MS;
    const dates = Array.from({ length: days }, (_, i) => vnDate(startMs + i * DAY_MS));

    // Phạm vi: mọi sự kiện của tôi, hoặc đúng một sự kiện.
    const scope = eventIdParam
      ? Prisma.sql`e.organizerId = ${organizerId} AND e.id = ${eventIdParam}`
      : Prisma.sql`e.organizerId = ${organizerId}`;

    // Mỗi đơn CONFIRMED trong phạm vi: số vé của đơn (theo phạm vi) và tổng tiền.
    const perOrder = Prisma.sql`
      SELECT t.orderId AS orderId, COUNT(*) AS qty
      FROM tickets t
      JOIN ticket_types tt ON tt.id = t.ticketTypeId
      JOIN events e ON e.id = tt.eventId
      WHERE ${scope}
      GROUP BY t.orderId`;

    const [totals, daily, prevRows, typeRows, ticketTypes] = await Promise.all([
      prisma.$queryRaw<Array<{ orders: bigint; revenue: unknown; discount: unknown; tickets: unknown }>>`
        SELECT COUNT(*) AS orders, SUM(o.totalAmount) AS revenue, SUM(o.discountAmount) AS discount, SUM(q.qty) AS tickets
        FROM orders o JOIN (${perOrder}) q ON q.orderId = o.id
        WHERE o.status = 'CONFIRMED'`,
      prisma.$queryRaw<Array<{ day: string; orders: bigint; revenue: unknown; tickets: unknown }>>`
        SELECT DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 7 HOUR), '%Y-%m-%d') AS day,
               COUNT(*) AS orders, SUM(o.totalAmount) AS revenue, SUM(q.qty) AS tickets
        FROM orders o JOIN (${perOrder}) q ON q.orderId = o.id
        WHERE o.status = 'CONFIRMED' AND o.createdAt >= ${new Date(startMs)}
        GROUP BY day`,
      prisma.$queryRaw<Array<{ orders: bigint; revenue: unknown; tickets: unknown }>>`
        SELECT COUNT(*) AS orders, SUM(o.totalAmount) AS revenue, SUM(q.qty) AS tickets
        FROM orders o JOIN (${perOrder}) q ON q.orderId = o.id
        WHERE o.status = 'CONFIRMED' AND o.createdAt >= ${new Date(prevStartMs)} AND o.createdAt < ${new Date(startMs)}`,
      // Theo loại vé: số vé đã bán, đã vào cổng, doanh thu (tổng tiền đơn chia đều cho vé).
      prisma.$queryRaw<Array<{ ticketTypeId: string; sold: bigint; checkedIn: unknown; revenue: unknown }>>`
        SELECT x.ticketTypeId AS ticketTypeId, COUNT(*) AS sold, SUM(x.checked) AS checkedIn, SUM(x.share) AS revenue
        FROM (
          SELECT t.ticketTypeId,
                 CASE WHEN t.checkedInAt IS NULL THEN 0 ELSE 1 END AS checked,
                 o.totalAmount / COUNT(*) OVER (PARTITION BY t.orderId) AS share
          FROM tickets t
          JOIN ticket_types tt ON tt.id = t.ticketTypeId
          JOIN events e ON e.id = tt.eventId
          JOIN orders o ON o.id = t.orderId
          WHERE ${scope} AND o.status = 'CONFIRMED'
        ) x
        GROUP BY x.ticketTypeId`,
      prisma.ticketType.findMany({
        where: { event: { organizerId, ...(eventIdParam ? { id: eventIdParam } : {}) } },
        select: { id: true, name: true, price: true, totalQuantity: true, eventId: true },
      }),
    ]);

    const eventById = new Map(events.map((e) => [e.id, e]));
    const statsByType = new Map(typeRows.map((r) => [r.ticketTypeId, r]));

    const types = ticketTypes.map((tt) => {
      const row = statsByType.get(tt.id);
      return {
        id: tt.id,
        name: tt.name,
        eventId: tt.eventId,
        eventTitle: eventById.get(tt.eventId)?.title ?? '',
        category: eventById.get(tt.eventId)?.category ?? 'OTHER',
        price: Number(tt.price),
        total: tt.totalQuantity,
        sold: num(row?.sold),
        checkedIn: num(row?.checkedIn),
        revenue: Math.round(num(row?.revenue)),
      };
    }).sort((a, b) => b.sold - a.sold || b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi'));

    // Tỉ lệ vào cổng theo sự kiện, chỉ sự kiện đã bán được vé.
    const byEvent = new Map<string, { sold: number; checkedIn: number }>();
    for (const t of types) {
      const agg = byEvent.get(t.eventId) ?? { sold: 0, checkedIn: 0 };
      agg.sold += t.sold;
      agg.checkedIn += t.checkedIn;
      byEvent.set(t.eventId, agg);
    }
    const eventsCheckIn = events
      .filter((e) => (byEvent.get(e.id)?.sold ?? 0) > 0)
      .slice(0, 20)
      .map((e) => ({ id: e.id, title: e.title, category: e.category, startTime: e.startTime, endTime: e.endTime, ...byEvent.get(e.id)! }));

    // Doanh thu và số vé bán theo danh mục sự kiện trên toàn thời gian.
    const categoryMap = new Map<EventCategory, { revenue: number; tickets: number }>();
    for (const t of types) {
      const category = eventById.get(t.eventId)?.category;
      if (!category) continue;
      const agg = categoryMap.get(category) ?? { revenue: 0, tickets: 0 };
      agg.revenue += t.revenue;
      agg.tickets += t.sold;
      categoryMap.set(category, agg);
    }
    const byCategory = Array.from(categoryMap.entries())
      .filter(([, agg]) => agg.revenue > 0 || agg.tickets > 0)
      .map(([category, agg]) => ({ category, revenue: Math.round(agg.revenue), tickets: agg.tickets }))
      .sort((a, b) => b.revenue - a.revenue || b.tickets - a.tickets || a.category.localeCompare(b.category));

    const dailyByDay = new Map(daily.map((d) => [d.day, d]));
    const dailySeries = dates.map((date) => {
      const row = dailyByDay.get(date);
      return { date, revenue: num(row?.revenue), orders: num(row?.orders), tickets: num(row?.tickets) };
    });
    const prev = prevRows[0];
    const period = {
      current: {
        revenue: Math.round(dailySeries.reduce((sum, d) => sum + d.revenue, 0)),
        orders: dailySeries.reduce((sum, d) => sum + d.orders, 0),
        tickets: dailySeries.reduce((sum, d) => sum + d.tickets, 0),
      },
      previous: {
        revenue: Math.round(num(prev?.revenue)),
        orders: num(prev?.orders),
        tickets: num(prev?.tickets),
      },
    };
    const total = totals[0];

    return res.json({
      message: 'Lấy bảng điều khiển bán vé thành công!',
      data: {
        eventId: eventIdParam,
        range: { days, from: dates[0], to: dates[dates.length - 1] },
        events: events.map((e) => ({ id: e.id, title: e.title, category: e.category, startTime: e.startTime })),
        summary: {
          revenue: num(total?.revenue),
          discount: num(total?.discount),
          orders: num(total?.orders),
          ticketsSold: num(total?.tickets),
          capacity: types.reduce((sum, t) => sum + t.total, 0),
          checkedIn: types.reduce((sum, t) => sum + t.checkedIn, 0),
        },
        period,
        daily: dailySeries,
        ticketTypes: types,
        byCategory,
        eventsCheckIn,
      },
    });
  } catch (error) {
    return handleControllerError(res, 'organizer.getSalesDashboard', error);
  }
};
