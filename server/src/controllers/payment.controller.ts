import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { enabledProviders, PAYMENT_HOLD_MINUTES } from '../config/payment';
import { AppError, handleControllerError } from '../utils/errors';
import { vnpayUrl, verifyVnpay, Fields } from '../payments/vnpay';
import { momoUrl, verifyMomo } from '../payments/momo';
import { completePayment, emailConfirmedOrder, markOrderConfirmed } from '../payments/complete';

export const providers = (_req: Request, res: Response) => res.json({ data: enabledProviders() });
export async function payOrder(req: Request, res: Response) {
  try {
    const provider = req.body.provider as 'VNPAY' | 'MOMO';
    if (!enabledProviders().includes(provider)) throw new AppError('Cổng thanh toán không khả dụng!', 409);
    const now = new Date();
    const expires = new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000);
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${req.params.id} FOR UPDATE`;
      const order = await tx.order.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
      if (!order) throw new AppError('Không tìm thấy đơn hàng!', 404);
      if (order.status !== 'PENDING' || !order.expiresAt || order.expiresAt <= new Date()) throw new AppError('Đơn hàng không còn trong thời gian thanh toán!', 409);
      if (order.totalAmount.isZero()) {
        await tx.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'CONFIRMED' } });
        return { order: await markOrderConfirmed(tx, order.id) };
      }
      if (await tx.payment.count({ where: { orderId: order.id } }) >= 3) throw new AppError('Đơn hàng đã đạt giới hạn 3 lần tạo thanh toán!', 409);
      // VNPay nhận phần trăm đồng; MoMo chỉ nhận số đồng nguyên.
      if (provider === 'MOMO' && !order.totalAmount.isInteger()) throw new AppError('MoMo chỉ hỗ trợ số tiền nguyên đồng!', 400);
      const payment = await tx.payment.create({ data: { orderId: order.id, provider, amount: order.totalAmount, txnRef: randomBytes(15).toString('base64url').replace(/[-_]/g, 'A') } });
      await tx.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { expiresAt: new Date(expires.getTime() + 5 * 60_000) } });
      return { payment };
    }, { timeout: 15_000 });
    if (result.order) { emailConfirmedOrder(result.order.id); return res.json({ message: 'Thanh toán thành công!', data: { order: result.order } }); }
    const p = result.payment!;
    let paymentUrl: string;
    try {
      paymentUrl = provider === 'VNPAY'
        ? vnpayUrl(p.txnRef, p.amount.mul(100).toFixed(0), p.orderId, req.ip || '127.0.0.1', now, expires)
        : await momoUrl(p.txnRef, p.amount.toFixed(0), p.orderId);
    } catch (error) {
      await prisma.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      throw error;
    }
    return res.json({ message: 'Đã tạo thanh toán!', data: { paymentUrl } });
  } catch (error) { return handleControllerError(res, 'payOrder', error); }
}
/** Từ chối mảng/object để tránh cách diễn giải chữ ký không thống nhất. */
function fields(input: unknown): Fields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Dữ liệu thanh toán không hợp lệ!');
  const out: Fields = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new AppError('Dữ liệu thanh toán không hợp lệ!');
    out[key] = String(value);
  }
  return out;
}
async function finish(provider: 'VNPAY' | 'MOMO', f: Fields) {
  if (provider === 'VNPAY') {
    if (f.vnp_TmnCode !== process.env.VNPAY_TMN_CODE || !/^\d+$/.test(f.vnp_Amount || '')) throw new AppError('Dữ liệu thanh toán không hợp lệ!');
    return completePayment({ provider, txnRef: f.vnp_TxnRef || '', amount: new Prisma.Decimal(f.vnp_Amount).div(100).toString(),
      success: f.vnp_ResponseCode === '00' && f.vnp_TransactionStatus === '00', providerTransactionId: f.vnp_TransactionNo });
  }
  return completePayment({ provider, txnRef: f.orderId, amount: f.amount, success: f.resultCode === '0', providerTransactionId: f.transId });
}
export async function vnpayIpn(req: Request, res: Response) {
  try {
    const f = fields(req.query);
    if (!verifyVnpay(f)) return res.json({ RspCode: '97', Message: 'Invalid signature' });
    const result = await finish('VNPAY', f);
    const code = result.kind === 'NOT_FOUND' ? '01' : result.kind === 'AMOUNT_MISMATCH' ? '04' : result.kind === 'ALREADY_PROCESSED' ? '02' : '00';
    return res.json({ RspCode: code, Message: code === '02' ? 'Order already confirmed' : code === '00' ? 'Confirm Success' : 'Invalid order' });
  } catch { return res.status(200).json({ RspCode: '99', Message: 'Unknown error' }); }
}
export async function momoIpn(req: Request, res: Response) {
  try {
    const f = fields(req.body);
    if (!verifyMomo(f)) throw new AppError('Chữ ký thanh toán không hợp lệ!', 400);
    const result = await finish('MOMO', f);
    if (result.kind === 'NOT_FOUND') throw new AppError('Không tìm thấy thanh toán!', 404);
    if (result.kind === 'AMOUNT_MISMATCH') throw new AppError('Số tiền thanh toán không khớp!', 400);
    return res.status(204).end();
  } catch (error) { return handleControllerError(res, 'momoIpn', error); }
}
export const paymentReturn = (provider: 'VNPAY' | 'MOMO') => async (req: Request, res: Response) => {
  try {
    const f = fields(req.query);
    if (!(provider === 'VNPAY' ? verifyVnpay(f) : verifyMomo(f))) throw new AppError('Chữ ký thanh toán không hợp lệ!', 400);
    const result = await finish(provider, f);
    if (result.kind === 'NOT_FOUND') throw new AppError('Không tìm thấy thanh toán!', 404);
    if (result.kind === 'AMOUNT_MISMATCH') throw new AppError('Số tiền thanh toán không khớp!', 400);
    return res.json({ message: 'Kết quả thanh toán!', data: { status: result.status, orderId: result.orderId, needsRefund: result.needsRefund } });
  } catch (error) { return handleControllerError(res, 'paymentReturn', error); }
};
