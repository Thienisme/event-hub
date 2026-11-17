import { Prisma, PromoCode } from '@prisma/client';
import { AppError } from './errors';

/** Tính tiền hoàn toàn bằng Decimal; phần trăm làm tròn xuống tới đồng. */
export function computeDiscount(subtotalAmount: Prisma.Decimal, promo: Pick<PromoCode, 'discountType' | 'discountValue'>) {
  const discountAmount = promo.discountType === 'PERCENT'
    ? subtotalAmount.mul(promo.discountValue).div(100).floor()
    : Prisma.Decimal.min(promo.discountValue, subtotalAmount);
  return { subtotalAmount, discountAmount, totalAmount: subtotalAmount.sub(discountAmount) };
}

/** Dùng chung lý do từ chối giữa preview và đặt vé. */
export async function applicablePromo(tx: Prisma.TransactionClient, eventId: string, code: string, userId: string, now = new Date(), excludeOrderId?: string) {
  const promo = await tx.promoCode.findUnique({ where: { eventId_code: { eventId, code: code.trim().toUpperCase() } } });
  if (!promo) throw new AppError('Mã giảm giá không tồn tại!');
  if (!promo.active) throw new AppError('Mã giảm giá đã bị tắt!');
  if (promo.startsAt && promo.startsAt > now) throw new AppError('Mã giảm giá chưa bắt đầu!');
  if (promo.endsAt && promo.endsAt <= now) throw new AppError('Mã giảm giá đã hết hạn!');
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) throw new AppError('Mã giảm giá đã hết lượt sử dụng!');
  const used = await tx.order.count({ where: { ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}), userId, promoCodeId: promo.id, status: { in: ['PENDING', 'CONFIRMED'] } } });
  if (used >= promo.perUserLimit) throw new AppError('Bạn đã dùng đủ số lần cho mã giảm giá này!');
  return promo;
}

/** Điều kiện hiển thị ưu đãi; việc chiếm lượt vẫn do claimPromoUsage bảo vệ. */
export function publicOfferWhere(eventId: string, now: Date): Prisma.PromoCodeWhereInput {
  return { eventId, isPublic: true, active: true, AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  ] };
}

export function hasRemainingUses(promo: PromoCode) {
  return promo.maxUses === null || promo.usedCount < promo.maxUses;
}

/** Chỉ xuất các trường được phép công khai. */
export function publicOffer(promo: PromoCode) {
  return { code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue.toString(),
    endsAt: promo.endsAt?.toISOString() ?? null,
    remainingUses: promo.maxUses === null ? null : promo.maxUses - promo.usedCount };
}
