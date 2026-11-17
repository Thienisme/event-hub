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
  try {
    const response = await fetch(momo.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, signature, lang: 'vi' }), signal: AbortSignal.timeout(10_000) });
    const body = await response.json() as { resultCode: number; payUrl?: string };
    if (!response.ok || body.resultCode !== 0 || !body.payUrl || !/^https:\/\//.test(body.payUrl)) throw new Error();
    return body.payUrl;
  } catch { throw new AppError('Không thể tạo thanh toán MoMo, vui lòng thử lại!', 502); }
}
