import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';

/**
 * Kết quả soát vé. Client hiển thị theo `result`, không dựa vào message.
 *   VALID          200  vé hợp lệ, vừa được đánh dấu đã vào cổng
 *   ALREADY_USED   409  vé đã check-in trước đó (kèm thời điểm)
 *   NOT_FOUND      404  không có vé nào mang mã này
 *   WRONG_EVENT    409  vé có thật nhưng thuộc sự kiện khác
 *   NOT_CONFIRMED  409  đơn của vé chưa thanh toán (phòng xa: chỉ đơn CONFIRMED mới có QR)
 */
export type CheckInResult = 'VALID' | 'ALREADY_USED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'NOT_CONFIRMED';

/**
 * Tải sự kiện và kiểm tra quyền soát vé: ORGANIZER của chính sự kiện, hoặc ADMIN.
 *
 * Kiểm tra quyền TRƯỚC khi tra mã QR: người không có quyền không được dùng
 * endpoint này để dò xem một mã có tồn tại hay không.
 * Dùng `currentRole` (đọc từ DB) chứ không phải `role` trong JWT.
 */
async function loadEventForStaff(req: Request) {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    select: { id: true, title: true, organizerId: true },
  });

  if (!event) throw new AppError('Không tìm thấy sự kiện!', 404);

  if (event.organizerId !== req.user!.userId && req.user?.currentRole !== 'ADMIN') {
    throw new AppError('Bạn không có quyền soát vé cho sự kiện này!', 403);
  }

  return event;
}

const TICKET_SELECT = {
  id: true,
  checkedInAt: true,
  ticketType: { select: { name: true, eventId: true, event: { select: { title: true } } } },
  order: { select: { status: true, user: { select: { fullName: true } } } },
} as const;

/**
 * POST /api/events/:id/check-in  { qrCode }
 *
 * CHỐNG QUÉT TRÙNG: hai máy quét cùng một vé cùng lúc thì chỉ một máy được báo
 * hợp lệ. Việc đánh dấu là MỘT câu `updateMany` có điều kiện `checkedInAt: null`;
 * MySQL khoá dòng khi UPDATE nên câu thứ hai thấy điều kiện không còn đúng và
 * trả `count = 0`. Không được đổi thành kiểu "đọc thấy chưa check-in rồi mới ghi":
 * hai request đọc cùng lúc đều thấy NULL và cùng báo hợp lệ.
 *
 * Trạng thái đơn đọc trước là đủ tin: CONFIRMED là trạng thái cuối, không đổi nữa.
 */
export const checkInTicket = async (req: Request, res: Response) => {
  try {
    const event = await loadEventForStaff(req);
    const qrCode: string = req.body.qrCode;

    const ticket = await prisma.ticket.findUnique({ where: { qrCode }, select: TICKET_SELECT });

    if (!ticket) {
      return res.status(404).json({ result: 'NOT_FOUND', message: 'Vé không tồn tại!' });
    }

    if (ticket.ticketType.eventId !== event.id) {
      // Chỉ nói vé thuộc sự kiện nào (thông tin công khai), không lộ người mua.
      return res.status(409).json({
        result: 'WRONG_EVENT',
        message: 'Vé không thuộc sự kiện này!',
        ticket: { eventTitle: ticket.ticketType.event.title },
      });
    }

    const info = {
      ticketTypeName: ticket.ticketType.name,
      eventTitle: ticket.ticketType.event.title,
      holderName: ticket.order.user.fullName,
    };

    if (ticket.order.status !== 'CONFIRMED') {
      return res.status(409).json({
        result: 'NOT_CONFIRMED',
        message: 'Vé thuộc đơn chưa thanh toán!',
        ticket: info,
      });
    }

    const now = new Date();
    const claimed = await prisma.ticket.updateMany({
      where: { id: ticket.id, checkedInAt: null },
      data: { checkedInAt: now, checkedInById: req.user!.userId },
    });

    if (claimed.count === 0) {
      const used = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { checkedInAt: true },
      });
      return res.status(409).json({
        result: 'ALREADY_USED',
        message: 'Vé đã được sử dụng!',
        ticket: { ...info, checkedInAt: used?.checkedInAt ?? ticket.checkedInAt },
      });
    }

    return res.json({
      result: 'VALID',
      message: 'Vé hợp lệ, mời vào!',
      ticket: { ...info, checkedInAt: now },
    });
  } catch (error) {
    return handleControllerError(res, 'checkInTicket', error);
  }
};

/**
 * GET /api/events/:id/check-in/stats
 * Số vé đã thanh toán và số vé đã vào cổng của sự kiện.
 */
export const getCheckInStats = async (req: Request, res: Response) => {
  try {
    const event = await loadEventForStaff(req);
    const where = { ticketType: { eventId: event.id }, order: { status: 'CONFIRMED' as const } };

    const [total, checkedIn] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.count({ where: { ...where, checkedInAt: { not: null } } }),
    ]);

    return res.json({
      message: 'Lấy thống kê soát vé thành công!',
      data: { eventId: event.id, eventTitle: event.title, total, checkedIn },
    });
  } catch (error) {
    return handleControllerError(res, 'getCheckInStats', error);
  }
};
