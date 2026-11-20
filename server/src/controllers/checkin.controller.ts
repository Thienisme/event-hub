import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { currentQrStep, parseDynamicQr, verifyDynamicQr } from '../utils/dynamicQr';
import { AppError, handleControllerError } from '../utils/errors';

/**
 * Kết quả soát vé. Client hiển thị theo `result`, không dựa vào message.
 *   VALID          200  vé hợp lệ, vừa được đánh dấu đã vào cổng
 *   ALREADY_USED   409  vé đã check-in trước đó (kèm thời điểm)
 *   QR_EXPIRED    409  chữ ký đúng nhưng mã đã ngoài cửa sổ thời gian
 *   STATIC_QR_NOT_ALLOWED 409 sự kiện chỉ nhận mã động
 *   NOT_FOUND      404  không có vé nào mang mã này
 *   WRONG_EVENT    409  vé có thật nhưng thuộc sự kiện khác
 *   NOT_CONFIRMED  409  đơn của vé chưa thanh toán (phòng xa: chỉ đơn CONFIRMED mới có QR)
 */
export type CheckInResult = 'VALID' | 'ALREADY_USED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'NOT_CONFIRMED' | 'QR_EXPIRED' | 'STATIC_QR_NOT_ALLOWED';

/**
 * Tải sự kiện và kiểm tra quyền soát vé: ORGANIZER của chính sự kiện, ADMIN,
 * hoặc nhân viên soát vé được gán cho sự kiện này (bảng `event_staff`, mọi role).
 *
 * Kiểm tra quyền TRƯỚC khi tra mã QR: người không có quyền không được dùng
 * endpoint này để dò xem một mã có tồn tại hay không.
 * Dùng `currentRole` (đọc từ DB) chứ không phải `role` trong JWT. Quyền nhân viên
 * đọc thẳng từ DB mỗi request (không cache) nên gỡ nhân viên là mất quyền ngay.
 */
async function loadEventForStaff(req: Request) {
  const userId = req.user!.userId;
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, title: true, organizerId: true, dynamicQrOnly: true,
      staff: { where: { userId }, select: { userId: true } },
    },
  });

  if (!event) throw new AppError('Không tìm thấy sự kiện!', 404);

  const isOwner = event.organizerId === userId && req.user?.currentRole === 'ORGANIZER';
  if (!isOwner && req.user?.currentRole !== 'ADMIN' && event.staff.length === 0) {
    throw new AppError('Bạn không có quyền soát vé cho sự kiện này!', 403);
  }

  return event;
}

const TICKET_SELECT = {
  id: true,
  qrCode: true,
  checkedInAt: true,
  ticketType: { select: { name: true, eventId: true, event: { select: { title: true } } } },
  order: { select: { status: true, user: { select: { fullName: true } } } },
  // Người giữ vé sau chuyển nhượng; NULL = người mua.
  holder: { select: { fullName: true } },
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

    const parsed = parseDynamicQr(qrCode);
    const ticket = await prisma.ticket.findUnique({
      where: parsed ? { id: parsed.ticketId } : { qrCode },
      select: TICKET_SELECT,
    });

    if (!ticket || (parsed && (!ticket.qrCode || !verifyDynamicQr(parsed, ticket.qrCode)))) {
      return res.status(404).json({ result: 'NOT_FOUND', message: 'Vé không tồn tại!' });
    }

    // Cửa sổ ±1 step chịu lệch đồng hồ và thời gian khách đứng chờ tại cổng.
    if (parsed && Math.abs(Number(parsed.step) - currentQrStep()) > 1) {
      return res.status(409).json({
        result: 'QR_EXPIRED',
        message: 'Mã QR đã hết hạn, nhờ khách mở lại vé trên điện thoại!',
      });
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
      holderName: (ticket.holder ?? ticket.order.user).fullName,
    };

    if (!parsed && event.dynamicQrOnly) {
      return res.status(409).json({
        result: 'STATIC_QR_NOT_ALLOWED',
        message: 'Sự kiện chỉ nhận mã QR động, nhờ khách mở vé trên điện thoại!',
        ticket: info,
      });
    }

    if (ticket.order.status !== 'CONFIRMED') {
      return res.status(409).json({
        result: 'NOT_CONFIRMED',
        message: 'Vé thuộc đơn chưa thanh toán!',
        ticket: info,
      });
    }

    const now = new Date();
    const claimed = await prisma.ticket.updateMany({
      // Kèm `qrCode` vừa tra: vé bị chuyển nhượng giữa lúc tra mã và lúc chiếm
      // (qrCode đã đổi) thì mã cũ không được soát.
      where: { id: ticket.id, checkedInAt: null, qrCode: ticket.qrCode },
      data: { checkedInAt: now, checkedInById: req.user!.userId },
    });

    if (claimed.count === 0) {
      const used = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { checkedInAt: true, qrCode: true },
      });
      if (used?.qrCode !== ticket.qrCode) {
        return res.status(404).json({ result: 'NOT_FOUND', message: 'Vé không tồn tại!' });
      }
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
