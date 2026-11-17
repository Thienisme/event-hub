import prisma from './prisma';
import { escapeHtml, sendMailSafe } from './mailer';

export function returnedQuantities(tickets: Array<{ ticketTypeId: string }>) {
  const quantities = new Map<string, number>();
  for (const ticket of tickets) quantities.set(ticket.ticketTypeId, (quantities.get(ticket.ticketTypeId) ?? 0) + 1);
  return Array.from(quantities, ([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
}

/** Chỉ báo tin sau commit, không giữ chỗ hay thay đổi tồn kho. */
export async function notifyWaitlist(returned: Array<{ ticketTypeId: string; quantity: number }>): Promise<void> {
  for (const { ticketTypeId, quantity } of returned) {
    try {
      if (!Number.isInteger(quantity) || quantity <= 0) continue;
      const ticket = await prisma.ticketType.findUnique({ where: { id: ticketTypeId }, include: { event: true } });
      if (!ticket || ticket.event.endTime <= new Date()) continue;
      const entries = await prisma.waitlistEntry.findMany({
        where: { ticketTypeId, notifiedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: quantity, include: { user: { select: { email: true } } },
      });
      for (const entry of entries) {
        try {
          // Dấu chiếm: lỗi gửi cũng không thử lại, tránh thư trùng giữa các instance.
          const claimed = await prisma.waitlistEntry.updateMany({
            where: { id: entry.id, notifiedAt: null, createdAt: entry.createdAt }, data: { notifiedAt: new Date() },
          });
          if (!claimed.count) continue;
          const link = new URL(`/events/${ticket.event.slug}`, process.env.APP_PUBLIC_URL || 'http://localhost:5173').toString();
          const subject = `Có vé trả lại: ${ticket.event.title}`;
          const detail = `${ticket.event.title}\nLoại vé: ${ticket.name}\nAi đặt trước sẽ được trước`;
          await sendMailSafe({ to: entry.user.email, subject, text: `${detail}\n${link}`,
            html: `<p>${escapeHtml(detail).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(link)}">Xem sự kiện</a></p>` });
        } catch { console.error('[waitlist] Không thể báo tin cho người chờ'); }
      }
    } catch { console.error('[waitlist] Không thể xử lý danh sách chờ'); }
  }
}
