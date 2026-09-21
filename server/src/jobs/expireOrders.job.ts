import prisma from '../utils/prisma';
import { invalidateEventCache } from '../utils/cache';

/**
 * Quét các đơn PENDING đã quá `expiresAt`, chuyển sang EXPIRED và trả vé về kho.
 *
 * VÌ SAO KHÔNG CẦN REDLOCK Ở ĐÂY (khác với createOrder):
 * createOrder phải khoá vì nó làm việc kiểu "đọc rồi ghi" (check availableQuantity
 * xong mới trừ), hai request chen nhau sẽ cùng đọc thấy còn vé và cùng trừ -> âm kho.
 * Ở đây ta không đọc giá trị cũ, mà dùng `updateMany` có kèm điều kiện
 * `status: 'PENDING'` như một phép compare-and-swap: MySQL khoá row lại, chỉ MỘT
 * worker đổi được PENDING -> EXPIRED, worker còn lại nhận `count = 0` và bỏ qua.
 * CAS mạnh hơn lock ở chỗ nó không thể bị "hết hạn lock giữa chừng".
 *
 * VÌ SAO PHẢI CÙNG MỘT TRANSACTION:
 * đổi trạng thái và cộng trả vé là 2 ghi riêng biệt. Nếu chúng nằm ngoài
 * transaction mà bước cộng vé lỗi, ta sẽ có đơn EXPIRED nhưng vé biến mất vĩnh viễn
 * (không còn đường trả lại vì đơn không còn PENDING để job bắt lần sau).
 *
 * @returns số đơn thực sự được giải phóng trong lượt này
 */
export async function releaseExpiredOrders(): Promise<number> {
  const expiredOrders = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      // So sánh với NULL luôn là false trong SQL, nên các đơn cũ chưa có
      // expiresAt sẽ được bỏ qua an toàn (không bị "hết hạn" oan).
      expiresAt: { lt: new Date() },
    },
    include: { tickets: true },
  });

  let releasedCount = 0;
  const touchedEventIds = new Set<string>();

  for (const order of expiredOrders) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Bước 1: CAS - chỉ worker thắng mới đi tiếp
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });

        if (claimed.count === 0) return null;

        // Bước 2: gom số vé cần trả về theo từng loại vé
        // (quantity vé = quantity record Ticket, xem createOrder)
        const quantityByTicketType = new Map<string, number>();
        for (const ticket of order.tickets) {
          quantityByTicketType.set(
            ticket.ticketTypeId,
            (quantityByTicketType.get(ticket.ticketTypeId) ?? 0) + 1
          );
        }

        // Bước 3: cộng trả vé
        const eventIds: string[] = [];
        for (const [ticketTypeId, quantity] of quantityByTicketType) {
          const ticketType = await tx.ticketType.update({
            where: { id: ticketTypeId },
            data: { availableQuantity: { increment: quantity } },
            select: { eventId: true },
          });
          eventIds.push(ticketType.eventId);
        }

        return { eventIds };
      });

      if (!result) continue; // worker khác đã xử lý đơn này

      releasedCount += 1;
      result.eventIds.forEach((eventId) => touchedEventIds.add(eventId));
    } catch (error) {
      // Một đơn lỗi không được làm chết cả lượt quét
      console.error(
        `[expire-orders] Lỗi khi xử lý đơn ${order.id}:`,
        (error as Error).message
      );
    }
  }

  // Trả vé xong phải xoá cache, nếu không UI còn thấy số vé cũ tới 60 giây
  if (touchedEventIds.size > 0) {
    await invalidateEventCache(Array.from(touchedEventIds));
  }

  return releasedCount;
}

/**
 * Bật job chạy nền. Quét ngay một lượt lúc khởi động (để bắt các đơn đã hết hạn
 * trong lúc server đang tắt), sau đó lặp mỗi ORDER_SWEEP_INTERVAL_MS.
 */
export function startExpireOrdersJob(): NodeJS.Timeout {
  const intervalMs = Number(process.env.ORDER_SWEEP_INTERVAL_MS ?? 60_000);

  const sweep = () => {
    releaseExpiredOrders()
      .then((count) => {
        if (count > 0) {
          console.log(`[expire-orders] Đã giải phóng ${count} đơn quá hạn, trả vé về kho.`);
        }
      })
      .catch((error) => {
        console.error('[expire-orders] Lỗi lượt quét:', (error as Error).message);
      });
  };

  sweep();

  const timer = setInterval(sweep, intervalMs);
  // Không giữ process sống chỉ vì job này
  timer.unref();

  console.log(
    `[expire-orders] Job đã bật: quét mỗi ${intervalMs / 1000}s, ` +
      `đơn giữ chỗ ${process.env.ORDER_HOLD_MINUTES ?? 10} phút.`
  );

  return timer;
}
