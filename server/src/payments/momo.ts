import { createHmac } from 'crypto';
import { apiPublicUrl, appPublicUrl, momo } from '../config/payment';
import { AppError } from '../utils/errors';
import { equalSignature, Fields } from './vnpay';
const sign = (fields: Fields, keys: string[]) => createHmac('sha256', momo.secret)
  .update(keys.map(k => `${k}=${fields[k]}`).join('&')).digest('hex');
export function verifyMomo(fields: Fields) {
  if (!momo.secret || fields.partnerCode !== momo.partnerCode || fields.orderId !== fields.requestId) return false;
  const keys = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
  if (keys.some(k => k !== 'accessKey' && typeof fields[k] !== 'string')) return false;
  return equalSignature(fields.signature || '', sign({ ...fields, accessKey: momo.accessKey }, keys));
}
export async function momoUrl(txnRef: string, amount: string, orderId: string): Promise<string> {
  const fields: Fields = {
    accessKey: momo.accessKey, amount, extraData: '', ipnUrl: `${apiPublicUrl}/api/payments/momo/ipn`,
    orderId: txnRef, orderInfo: `Thanh toan don ${orderId.slice(0, 8)}`, partnerCode: momo.partnerCode,
    redirectUrl: `${appPublicUrl}/payment/result?provider=momo`, requestId: txnRef, requestType: 'captureWallet',
  };
  const signature = sign(fields, ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType']);
  let response: Response;
  try {
    response = await fetch(momo.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, signature, lang: 'vi' }), signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    // Không kết nối được tới MoMo (timeout, DNS, bị chặn mạng...). Ghi tên lỗi và mã của nguyên nhân gốc.
    const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    console.error(`[momo] Lỗi mạng khi tạo thanh toán ${txnRef}: ${e.name} ${e.message}`
      + (e.cause ? ` (cause: ${e.cause.code ?? ''} ${e.cause.message ?? ''})` : ''));
    throw new AppError('Không thể tạo thanh toán MoMo, vui lòng thử lại!', 502);
  }
  const text = await response.text().catch(() => '');
  let body: { resultCode?: number; message?: string; payUrl?: string } = {};
  try { body = JSON.parse(text); } catch { /* MoMo trả về không phải JSON, log phần đầu bên dưới */ }
  if (!response.ok || body.resultCode !== 0 || !body.payUrl || !/^https:\/\//.test(body.payUrl)) {
    // Chỉ log mã HTTP, resultCode và message của MoMo; không log khoá hay chữ ký.
    console.error(`[momo] MoMo từ chối tạo thanh toán ${txnRef}: HTTP ${response.status}, resultCode=${body.resultCode ?? '?'}, `
      + `message=${JSON.stringify(body.message ?? text.slice(0, 200))}`);
    throw new AppError('Không thể tạo thanh toán MoMo, vui lòng thử lại!', 502);
  }
  return body.payUrl;
}
