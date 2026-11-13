import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';

export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const ticketTypeId = req.params.id;
    const userId = req.user!.userId;
    await prisma.$transaction(async tx => {
      // Khoá cùng dòng tồn kho để kiểm tra hết vé nhất quán với thao tác đặt/trả vé.
      const [ticket] = await tx.$queryRaw<Array<{ availableQuantity: number; endTime: Date }>>`
        SELECT t.availableQuantity, e.endTime FROM ticket_types t
        JOIN events e ON e.id = t.eventId WHERE t.id = ${ticketTypeId} FOR UPDATE`;
      if (!ticket) throw new AppError('Không tìm thấy loại vé!', 404);
      if (ticket.endTime <= new Date()) throw new AppError('Sự kiện đã kết thúc!', 409);
      if (ticket.availableQuantity !== 0) throw new AppError('Loại vé vẫn còn, bạn có thể đặt ngay', 409);
      await tx.waitlistEntry.upsert({
        where: { ticketTypeId_userId: { ticketTypeId, userId } },
        create: { ticketTypeId, userId }, update: {},
      });
      // Đăng ký lặp khi vẫn chờ giữ nguyên vị trí; chỉ người đã được báo về cuối hàng.
      await tx.waitlistEntry.updateMany({
        where: { ticketTypeId, userId, notifiedAt: { not: null } },
        data: { notifiedAt: null, createdAt: new Date() },
      });
    });
    return res.status(201).json({ message: 'Đã tham gia danh sách chờ!' });
  } catch (error) { return handleControllerError(res, 'joinWaitlist', error); }
};

export const leaveWaitlist = async (req: Request, res: Response) => {
  try {
    await prisma.waitlistEntry.deleteMany({ where: { ticketTypeId: req.params.id, userId: req.user!.userId } });
    return res.json({ message: 'Đã rời danh sách chờ!' });
  } catch (error) { return handleControllerError(res, 'leaveWaitlist', error); }
};

export const getMyWaitlist = async (req: Request, res: Response) => {
  try {
    const entries = await prisma.waitlistEntry.findMany({
      where: { userId: req.user!.userId, notifiedAt: null, ticketType: { eventId: req.params.id } },
      select: { ticketTypeId: true },
    });
    return res.json({ data: { ticketTypeIds: entries.map(entry => entry.ticketTypeId) } });
  } catch (error) { return handleControllerError(res, 'getMyWaitlist', error); }
};
