import { Prisma } from '@prisma/client';

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
