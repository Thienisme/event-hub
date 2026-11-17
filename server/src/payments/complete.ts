import { Prisma, PaymentProvider, PaymentStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import prisma from '../utils/prisma';
import { sendTicketEmail } from '../utils/ticketEmail';

/** Chỉ gọi sau khi CAS đã chuyển đơn sang CONFIRMED trong cùng transaction. */
export async function markOrderConfirmed(tx: Prisma.TransactionClient, orderId: string) {
  const tickets = await tx.ticket.findMany({ where: { orderId }, select: { id: true } });
  for (const ticket of tickets) await tx.ticket.update({ where: { id: ticket.id }, data: { qrCode: randomBytes(16).toString('base64url') } });
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true } });
}
export const emailConfirmedOrder = (orderId: string) => {
  void sendTicketEmail(orderId).catch(() => console.error(`[payment] Không gửi được email vé cho đơn ${orderId}`));
};
type Result = { kind: 'NOT_FOUND' } | { kind: 'AMOUNT_MISMATCH' } | {
  kind: 'PROCESSED' | 'ALREADY_PROCESSED'; status: PaymentStatus; orderId: string; needsRefund: boolean;
};
export async function completePayment(input: { provider: PaymentProvider; txnRef: string; success: boolean; amount: string; providerTransactionId?: string }): Promise<Result> {
  let confirmed: string | undefined;
  const result = await prisma.$transaction(async (tx): Promise<Result> => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM payments WHERE txnRef = ${input.txnRef} FOR UPDATE`;
    if (!rows.length) return { kind: 'NOT_FOUND' };
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (payment.provider !== input.provider) return { kind: 'NOT_FOUND' };
    const output = (kind: 'PROCESSED' | 'ALREADY_PROCESSED', p = payment): Result => ({ kind, status: p.status, orderId: p.orderId, needsRefund: p.needsRefund });
    if (payment.status !== 'PENDING') return output('ALREADY_PROCESSED');
    if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || !payment.amount.equals(input.amount)) return { kind: 'AMOUNT_MISMATCH' };
    let needsRefund = false;
    if (input.success) {
      const claimed = await tx.order.updateMany({ where: { id: payment.orderId, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
      if (claimed.count) { await markOrderConfirmed(tx, payment.orderId); confirmed = payment.orderId; }
      else { needsRefund = true; }
    }
    const updated = await tx.payment.update({ where: { id: payment.id }, data: {
      status: input.success ? 'SUCCEEDED' : 'FAILED', paidAt: input.success ? new Date() : null,
      providerTransactionId: input.providerTransactionId?.slice(0, 191), needsRefund,
    } });
    return output('PROCESSED', updated);
  }, { timeout: 15_000 });
  if (confirmed) emailConfirmedOrder(confirmed);
  if ('needsRefund' in result && result.needsRefund && result.kind === 'PROCESSED') console.error(`[payment] Cần hoàn tiền cho đơn ${result.orderId}`);
  return result;
}
