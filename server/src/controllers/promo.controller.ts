import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError, handleControllerError } from '../utils/errors';
import { applicablePromo, computeDiscount } from '../utils/promo';
import { exceedsOrderAmount } from '../utils/validation';

async function requireOwner(tx: Prisma.TransactionClient, eventId: string, req: Request) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
  if (!event) throw new AppError('Không tìm thấy sự kiện!', 404);
  if (req.user!.currentRole !== 'ADMIN' &&
      (req.user!.currentRole !== 'ORGANIZER' || event.organizerId !== req.user!.userId)) {
    throw new AppError('Bạn không có quyền quản lý mã giảm giá của sự kiện này!', 403);
  }
}

/** Kiểm tra cấu hình sau khi ghép PATCH với dữ liệu hiện tại. */
function checkConfiguration(data: { discountType: string; discountValue: Prisma.Decimal.Value; startsAt?: Date | string | null; endsAt?: Date | string | null }) {
  const value = new Prisma.Decimal(data.discountValue);
  if (data.discountType === 'PERCENT' && (!value.isInteger() || value.lt(1) || value.gt(100))) {
    throw new AppError('Giảm giá phần trăm phải là số nguyên từ 1 đến 100!');
  }
  if (data.startsAt && data.endsAt && new Date(data.endsAt) <= new Date(data.startsAt)) {
    throw new AppError('Thời gian kết thúc phải sau thời gian bắt đầu!');
  }
}

function promoData(body: Record<string, any>) {
  const data = { ...body };
  for (const key of ['startsAt', 'endsAt']) {
    if (data[key] !== undefined && data[key] !== null) data[key] = new Date(data[key]);
  }
  return data;
}

export const listPromoCodes = async (req: Request, res: Response) => {
  try {
    const data = await prisma.$transaction(async tx => {
      await requireOwner(tx, req.params.id, req);
      return tx.promoCode.findMany({ where: { eventId: req.params.id }, orderBy: { createdAt: 'desc' } });
    });
    return res.json({ message: 'Lấy danh sách mã giảm giá thành công!', data });
  } catch (error) { return handleControllerError(res, 'listPromoCodes', error); }
};

export const createPromoCode = async (req: Request, res: Response) => {
  try {
    const data = await prisma.$transaction(async tx => {
      await requireOwner(tx, req.params.id, req);
      const input = promoData(req.body) as Prisma.PromoCodeUncheckedCreateInput;
      checkConfiguration({ ...input, discountValue: input.discountValue.toString() });
      return tx.promoCode.create({ data: { ...input, eventId: req.params.id } });
    });
    return res.status(201).json({ message: 'Tạo mã giảm giá thành công!', data });
  } catch (error) { return handleControllerError(res, 'createPromoCode', error); }
};

export const updatePromoCode = async (req: Request, res: Response) => {
  try {
    const data = await prisma.$transaction(async tx => {
      // Đọc thông tin nội bộ để xác định sự kiện, chưa trả dữ liệu mã cho người gọi.
      const found = await tx.promoCode.findUnique({ where: { id: req.params.id } });
      if (!found) throw new AppError('Mã giảm giá không tồn tại!', 404);
      await requireOwner(tx, found.eventId, req);
      // Khoá dòng để maxUses không thấp hơn usedCount kể cả khi đang có người đặt vé.
      const [current] = await tx.$queryRaw<Array<typeof found>>`SELECT * FROM promo_codes WHERE id = ${found.id} FOR UPDATE`;
      if (!current) throw new AppError('Mã giảm giá không tồn tại!', 404);
      const input = promoData(req.body);
      checkConfiguration({ ...current, ...input });
      if (input.maxUses != null && input.maxUses < current.usedCount) {
        throw new AppError('Giới hạn sử dụng không được nhỏ hơn số lượt đã dùng!', 409);
      }
      return tx.promoCode.update({ where: { id: current.id }, data: input });
    });
    return res.json({ message: 'Cập nhật mã giảm giá thành công!', data });
  } catch (error) { return handleControllerError(res, 'updatePromoCode', error); }
};

export const deletePromoCode = async (req: Request, res: Response) => {
  try {
    await prisma.$transaction(async tx => {
      const promo = await tx.promoCode.findUnique({ where: { id: req.params.id } });
      if (!promo) throw new AppError('Mã giảm giá không tồn tại!', 404);
      await requireOwner(tx, promo.eventId, req);
      const deleted = await tx.promoCode.deleteMany({ where: { id: promo.id, usedCount: 0 } });
      if (deleted.count !== 1) throw new AppError('Mã đã được dùng, chỉ có thể tắt', 409);
    });
    return res.json({ message: 'Xoá mã giảm giá thành công!' });
  } catch (error) { return handleControllerError(res, 'deletePromoCode', error); }
};

export const previewPromoCode = async (req: Request, res: Response) => {
  try {
    const data = await prisma.$transaction(async tx => {
      const { code, ticketTypeId, quantity } = req.body;
      const ticket = await tx.ticketType.findUnique({ where: { id: ticketTypeId } });
      if (!ticket) throw new AppError('Loại vé không tồn tại!');
      if (exceedsOrderAmount(ticket.price.toNumber(), quantity)) throw new AppError('Tổng tiền của đơn hàng vượt quá giới hạn cho phép!');
      const promo = await applicablePromo(tx, ticket.eventId, code, req.user!.userId);
      return { code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue,
        ...computeDiscount(ticket.price.mul(quantity), promo) };
    });
    return res.json({ message: 'Áp dụng mã giảm giá thành công!', data });
  } catch (error) { return handleControllerError(res, 'previewPromoCode', error); }
};
