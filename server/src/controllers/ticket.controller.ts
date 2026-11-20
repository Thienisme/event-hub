import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { sendTransferReceivedEmail } from '../utils/ticketEmail';

/** Lỗi 409 kèm `code` để client hiển thị đúng trường hợp. */
class TransferConflict extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const NOT_FOUND = 'Không tìm thấy vé!';

/**
 * POST /api/tickets/:id/transfer  { email }
 *
 * Chuyển một vé cho tài khoản khác. Người giữ hiện tại = `holderId ?? order.userId`.
 * Chuyển xong `qrCode` được sinh mới, nên mọi mã cũ (QR tĩnh, QR động vì khoá
 * HMAC là qrCode, mã in trong email, ảnh chụp màn hình) chết ngay.
 *
 * CHỐNG TRANH CHẤP: đổi chủ bằng MỘT `updateMany` có điều kiện đúng qrCode,
 * holderId vừa đọc và `checkedInAt: null`. Hai yêu cầu chuyển cùng lúc thì chỉ
 * một câu UPDATE còn khớp điều kiện (MySQL khoá dòng khi UPDATE), câu kia nhận
 * count = 0 -> 409 TICKET_CHANGED. Vé vừa được soát ở cổng cũng làm điều kiện
 * `checkedInAt: null` sai. Không đổi thành kiểu đọc rồi ghi không điều kiện.
 */
export const transferTicket = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const email: string = req.body.email;

    const recipient = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, isActive: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { id: req.params.id },
        select: {
          id: true, qrCode: true, holderId: true, checkedInAt: true,
          order: { select: { userId: true, status: true } },
          ticketType: { select: { name: true, event: { select: { title: true, startTime: true } } } },
        },
      });

      // Vé không tồn tại và vé của người khác trả cùng một thông báo.
      if (!ticket || (ticket.holderId ?? ticket.order.userId) !== userId) throw new AppError(NOT_FOUND, 404);
      if (ticket.order.status !== 'CONFIRMED' || !ticket.qrCode) {
        throw new TransferConflict('NOT_CONFIRMED', 'Chỉ chuyển được vé của đơn đã thanh toán!');
      }
      if (ticket.checkedInAt) throw new TransferConflict('ALREADY_CHECKED_IN', 'Vé đã được sử dụng, không thể chuyển!');
      if (ticket.ticketType.event.startTime.getTime() <= Date.now()) {
        throw new TransferConflict('EVENT_STARTED', 'Sự kiện đã bắt đầu, không thể chuyển vé!');
      }

      if (!recipient || !recipient.isActive) throw new AppError('Không tìm thấy tài khoản với email này!', 404);
      if (recipient.id === userId) throw new AppError('Không thể chuyển vé cho chính mình!', 400);

      const claimed = await tx.ticket.updateMany({
        where: { id: ticket.id, qrCode: ticket.qrCode, holderId: ticket.holderId, checkedInAt: null },
        data: { holderId: recipient.id, qrCode: randomBytes(16).toString('base64url') },
      });
      if (claimed.count === 0) {
        throw new TransferConflict('TICKET_CHANGED', 'Vé vừa thay đổi, vui lòng tải lại trang!');
      }

      const transfer = await tx.ticketTransfer.create({
        data: { ticketId: ticket.id, fromUserId: userId, toUserId: recipient.id },
        select: { createdAt: true },
      });
      return { ticket, transfer };
    });

    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    // Gửi nền sau commit; lỗi email không ảnh hưởng việc chuyển vé.
    void sendTransferReceivedEmail({
      toEmail: recipient!.email,
      fromName: sender?.fullName ?? 'một người dùng EventHub',
      eventTitle: result.ticket.ticketType.event.title,
      eventStart: result.ticket.ticketType.event.startTime,
      ticketTypeName: result.ticket.ticketType.name,
    });

    return res.json({
      message: 'Chuyển vé thành công!',
      transfer: {
        ticketId: result.ticket.id,
        toUser: { fullName: recipient!.fullName, email: recipient!.email },
        createdAt: result.transfer.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof TransferConflict) {
      return res.status(409).json({ code: error.code, message: error.message });
    }
    return handleControllerError(res, 'transferTicket', error);
  }
};
