import { Prisma } from '@prisma/client';
import { AppError } from './errors';

/**
 * Cộng trả kho cho các vé của một đơn vừa được giải phóng (hết hạn hoặc huỷ).
 *
 * PHẢI gọi trong cùng transaction với bước đổi trạng thái có điều kiện của đơn:
 * nếu tách rời mà bước cộng vé lỗi, đơn đã rời khỏi PENDING và vé mất vĩnh viễn.
 *
 * @returns id các sự kiện bị ảnh hưởng, để nơi gọi vô hiệu cache sau khi commit
 */
export async function returnTicketsToStock(
  tx: Prisma.TransactionClient,
  tickets: Array<{ ticketTypeId: string }>
): Promise<string[]> {
  // Một Ticket là một vé, nên số vé cần trả chính là số dòng theo từng loại.
  const quantityByTicketType = new Map<string, number>();
  for (const ticket of tickets) {
    quantityByTicketType.set(
      ticket.ticketTypeId,
      (quantityByTicketType.get(ticket.ticketTypeId) ?? 0) + 1
    );
  }

  const eventIds: string[] = [];
  for (const [ticketTypeId, quantity] of quantityByTicketType) {
    const ticketType = await tx.ticketType.update({
      where: { id: ticketTypeId },
      data: { availableQuantity: { increment: quantity } },
      select: { eventId: true },
    });
    eventIds.push(ticketType.eventId);
  }

  return eventIds;
}

/** Chỉ gọi sau khi thắng CAS giải phóng đơn, trong cùng transaction. */
export async function releasePromoUsage(tx: Prisma.TransactionClient, order: { promoCodeId: string | null }) {
  if (order.promoCodeId) {
    await tx.$executeRaw`UPDATE promo_codes SET usedCount = usedCount - 1
      WHERE id = ${order.promoCodeId} AND usedCount > 0`;
  }
}

/** Chiếm lượt bằng cập nhật có điều kiện, trong transaction tạo hoặc đổi mã đơn. */
export async function claimPromoUsage(tx: Prisma.TransactionClient, promoId: string) {
  const claimed = await tx.$executeRaw`UPDATE promo_codes SET usedCount = usedCount + 1
          WHERE id = ${promoId} AND active = 1 AND (maxUses IS NULL OR usedCount < maxUses)`;
  if (claimed !== 1) throw new AppError('Mã giảm giá đã hết lượt sử dụng!');
}
