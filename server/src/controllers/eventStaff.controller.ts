import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { escapeHtml, sendMailSafe } from '../utils/mailer';

/**
 * Nhân viên soát vé theo từng sự kiện.
 *
 * Nhà tổ chức gán một tài khoản EventHub bất kỳ (thường là CUSTOMER) làm nhân
 * viên của MỘT sự kiện. Nhân viên chỉ được gọi hai route soát vé của sự kiện đó
 * (`checkin.controller.ts` kiểm bảng `event_staff`); không sửa được sự kiện, loại
 * vé hay mã giảm giá vì các route đó vẫn yêu cầu role ORGANIZER/ADMIN và quyền sở hữu.
 */

/** Trần số nhân viên mỗi sự kiện: đủ cho nhiều cổng, chặn việc thêm tràn lan. */
export const MAX_STAFF_PER_EVENT = 20;

/** Chỉ ORGANIZER của chính sự kiện hoặc ADMIN được quản lý nhân viên. */
async function requireOwner(tx: Prisma.TransactionClient, eventId: string, req: Request) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, startTime: true, organizerId: true },
  });
  if (!event) throw new AppError('Không tìm thấy sự kiện!', 404);
  if (req.user!.currentRole !== 'ADMIN' &&
      (req.user!.currentRole !== 'ORGANIZER' || event.organizerId !== req.user!.userId)) {
    throw new AppError('Bạn không có quyền quản lý nhân viên của sự kiện này!', 403);
  }
  return event;
}

/** Số vé mỗi nhân viên đã soát ở sự kiện này, theo `tickets.checkedInById`. */
async function scanCounts(eventId: string, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, number>();
  const rows = await prisma.ticket.groupBy({
    by: ['checkedInById'],
    where: { ticketType: { eventId }, checkedInById: { in: userIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.checkedInById as string, row._count._all]));
}

/**
 * GET /api/events/:id/staff
 * Danh sách nhân viên kèm số vé mỗi người đã soát.
 */
export const listEventStaff = async (req: Request, res: Response) => {
  try {
    const event = await requireOwner(prisma, req.params.id, req);
    const staff = await prisma.eventStaff.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, user: { select: { id: true, email: true, fullName: true, isActive: true } } },
    });
    const counts = await scanCounts(event.id, staff.map((s) => s.user.id));

    return res.json({
      message: 'Lấy danh sách nhân viên soát vé thành công!',
      data: {
        eventId: event.id,
        eventTitle: event.title,
        maxStaff: MAX_STAFF_PER_EVENT,
        staff: staff.map((s) => ({
          userId: s.user.id,
          email: s.user.email,
          fullName: s.user.fullName,
          isActive: s.user.isActive,
          addedAt: s.createdAt,
          checkedInCount: counts.get(s.user.id) ?? 0,
        })),
      },
    });
  } catch (error) {
    return handleControllerError(res, 'listEventStaff', error);
  }
};

/**
 * POST /api/events/:id/staff  { email }
 *
 * Trần MAX_STAFF_PER_EVENT: khoá dòng sự kiện bằng `FOR UPDATE` rồi mới đếm, nên
 * hai request thêm cùng lúc không cùng đọc thấy "còn chỗ" rồi cùng vượt trần.
 * Thêm trùng một người do khoá chính (eventId, userId) chặn: kiểm trước để trả
 * thông báo rõ, và nếu hai request trùng lọt qua cùng lúc thì P2002 -> 409.
 */
export const addEventStaff = async (req: Request, res: Response) => {
  try {
    const email: string = req.body.email;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${req.params.id} FOR UPDATE`;
      const event = await requireOwner(tx, req.params.id, req);

      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true, email: true, fullName: true, isActive: true },
      });
      if (!user || !user.isActive) throw new AppError('Không tìm thấy tài khoản với email này!', 404);
      if (user.id === event.organizerId) {
        throw new AppError('Nhà tổ chức đã có quyền soát vé, không cần thêm làm nhân viên!', 400);
      }

      const existing = await tx.eventStaff.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
        select: { userId: true },
      });
      if (existing) throw new AppError('Tài khoản này đã là nhân viên soát vé của sự kiện!', 409);

      const count = await tx.eventStaff.count({ where: { eventId: event.id } });
      if (count >= MAX_STAFF_PER_EVENT) {
        throw new AppError(`Mỗi sự kiện có tối đa ${MAX_STAFF_PER_EVENT} nhân viên soát vé!`, 409);
      }

      const staff = await tx.eventStaff.create({
        data: { eventId: event.id, userId: user.id },
        select: { createdAt: true },
      });
      return { event, user, staff };
    });

    // Gửi nền sau commit; lỗi email không ảnh hưởng việc thêm nhân viên.
    void sendStaffAddedEmail(result.user.email, result.event.title, result.event.startTime);

    return res.status(201).json({
      message: `Đã thêm ${result.user.fullName} làm nhân viên soát vé!`,
      data: {
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        isActive: result.user.isActive,
        addedAt: result.staff.createdAt,
        checkedInCount: 0,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: 'Tài khoản này đã là nhân viên soát vé của sự kiện!' });
    }
    return handleControllerError(res, 'addEventStaff', error);
  }
};

/**
 * DELETE /api/events/:id/staff/:userId
 * Gỡ nhân viên. Quyền soát vé đọc thẳng từ DB nên mất hiệu lực ngay ở request kế tiếp.
 */
export const removeEventStaff = async (req: Request, res: Response) => {
  try {
    const event = await requireOwner(prisma, req.params.id, req);
    const removed = await prisma.eventStaff.deleteMany({ where: { eventId: event.id, userId: req.params.userId } });
    if (removed.count === 0) throw new AppError('Không tìm thấy nhân viên này trong sự kiện!', 404);
    return res.json({ message: 'Đã gỡ nhân viên soát vé!' });
  } catch (error) {
    return handleControllerError(res, 'removeEventStaff', error);
  }
};

/**
 * GET /api/check-in/events
 * Các sự kiện tài khoản đang đăng nhập được gán soát vé, sắp xếp theo giờ bắt đầu.
 * Chỉ trả những gì cần để mở trang soát vé, không trả số liệu bán hàng.
 */
export const listMyCheckInEvents = async (req: Request, res: Response) => {
  try {
    const rows = await prisma.eventStaff.findMany({
      where: { userId: req.user!.userId },
      select: {
        event: {
          select: { id: true, title: true, location: true, startTime: true, endTime: true, bannerUrl: true, organizer: { select: { fullName: true } } },
        },
      },
      orderBy: { event: { startTime: 'asc' } },
      take: 100,
    });

    return res.json({
      message: 'Lấy danh sách sự kiện soát vé thành công!',
      data: rows.map(({ event }) => ({
        id: event.id,
        title: event.title,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        bannerUrl: event.bannerUrl,
        organizerName: event.organizer.fullName,
      })),
    });
  } catch (error) {
    return handleControllerError(res, 'listMyCheckInEvents', error);
  }
};

async function sendStaffAddedEmail(toEmail: string, eventTitle: string, eventStart: Date): Promise<void> {
  try {
    const link = new URL('/check-in', process.env.APP_PUBLIC_URL || 'http://localhost:5173').toString();
    const time = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short',
    }).format(eventStart);
    const title = `Bạn được thêm làm nhân viên soát vé: ${eventTitle}`;
    const detail = `${eventTitle}\nThời gian: ${time} (giờ Việt Nam)\nĐăng nhập EventHub rồi mở mục "Soát vé" để quét mã QR của khách.`;
    await sendMailSafe({
      to: toEmail,
      subject: title,
      text: `${title}\n\n${detail}\n\nMở trang soát vé: ${link}`,
      html: `<html lang="vi"><body style="background:#FFFFFF;color:#000000;font-family:Arial,sans-serif;padding:24px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#FF5A1F;color:#111111;font-weight:700;padding:12px 20px;text-decoration:none">Mở trang soát vé</a></p></body></html>`,
    });
  } catch {
    console.error('[email] Không thể gửi email thêm nhân viên soát vé');
  }
}
