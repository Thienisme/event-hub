import prisma from './prisma';
import { escapeHtml, sendMailSafe } from './mailer';

export const ticketEmailInclude = {
  user: { select: { email: true } },
  tickets: { include: { ticketType: { include: { event: true } } } },
} as const;

export type TicketEmailOrder = Awaited<ReturnType<typeof loadTicketEmailOrder>>;
const loadTicketEmailOrder = (id: string) => prisma.order.findUniqueOrThrow({
  where: { id }, include: ticketEmailInclude,
});

/** Mọi lỗi, kể cả đọc dữ liệu và dựng thư, đều không ảnh hưởng thanh toán. */
export async function sendTicketEmail(orderId: string): Promise<void> {
  try {
    await sendOrderEmail(await loadTicketEmailOrder(orderId), false);
  } catch {
    console.error('[email] Không thể chuẩn bị email vé');
  }
}

export async function sendOrderEmail(order: TicketEmailOrder, reminder: boolean): Promise<void> {
  const title = reminder ? 'Nhắc lịch sự kiện trong 24 giờ tới' : 'Vé của bạn đã được thanh toán';
  const link = new URL('/my-orders', process.env.APP_PUBLIC_URL || 'http://localhost:5173').toString();
  const details = order.tickets.map(ticket => {
    const event = ticket.ticketType.event;
    const time = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short',
    }).format(event.startTime);
    return `${event.title}\nThời gian: ${time} (giờ Việt Nam)\nĐịa điểm: ${event.location}\nLoại vé: ${ticket.ticketType.name}\nMã vé: ${ticket.qrCode ?? ''}`;
  });
  await sendMailSafe({
    to: order.user.email,
    subject: title,
    text: `${title}\n\n${details.join('\n\n')}\n\nXem QR: ${link}`,
    html: `<html lang="vi"><body style="background:#FFFFFF;color:#000000;font-family:Arial,sans-serif;padding:24px"><h1>${escapeHtml(title)}</h1>${details.map(detail => `<p>${escapeHtml(detail).replace(/\n/g, '<br>')}</p>`).join('')}<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#8C1C2B;color:#FFFFFF;padding:12px 20px;text-decoration:none">Xem vé và QR</a></p></body></html>`,
  });
}
