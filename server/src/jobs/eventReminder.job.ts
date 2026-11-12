import prisma from '../utils/prisma';
import { sendOrderEmail, ticketEmailInclude } from '../utils/ticketEmail';

/** Chiếm trước khi gửi: ưu tiên không gửi trùng, không thử lại thư gửi lỗi. */
export async function sweepEventReminders(): Promise<number> {
  const now = new Date();
  const startTime = { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
  const orders = await prisma.order.findMany({
    where: {
      status: 'CONFIRMED', reminderSentAt: null,
      tickets: { some: { ticketType: { event: { startTime } } } },
    },
    include: ticketEmailInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  let claimedCount = 0;
  for (const order of orders) {
    try {
      const claimed = await prisma.order.updateMany({
        where: { id: order.id, status: 'CONFIRMED', reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;
      claimedCount++;
      await sendOrderEmail(order, true);
    } catch {
      console.error(`[event-reminder] Lỗi khi xử lý đơn ${order.id}`);
    }
  }
  return claimedCount;
}

export function startEventReminderJob(): NodeJS.Timeout {
  const configured = Number(process.env.REMINDER_SWEEP_INTERVAL_MS ?? 15 * 60_000);
  const intervalMs = Number.isFinite(configured) && configured > 0 ? configured : 15 * 60_000;
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await sweepEventReminders(); }
    catch { console.error('[event-reminder] Lỗi lượt quét nhắc lịch'); }
    finally { running = false; }
  };
  void sweep();
  const timer = setInterval(() => { void sweep(); }, intervalMs);
  timer.unref();
  return timer;
}
