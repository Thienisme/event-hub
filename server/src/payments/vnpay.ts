import { createHmac, timingSafeEqual } from 'crypto';
import { appPublicUrl, vnpay } from '../config/payment';
export type Fields = Record<string, string>;
const encode = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
export const canonicalVnpay = (fields: Fields): string => Object.keys(fields)
  .filter(k => k.startsWith('vnp_') && !['vnp_SecureHash', 'vnp_SecureHashType'].includes(k))
  .sort().map(k => `${encode(k)}=${encode(fields[k])}`).join('&');
export const equalSignature = (actual: string, expected: string): boolean => {
  if (!/^[a-fA-F0-9]+$/.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual.toLowerCase()), Buffer.from(expected));
};
export const signVnpay = (fields: Fields) => createHmac('sha512', vnpay.secret).update(canonicalVnpay(fields)).digest('hex');
export const verifyVnpay = (fields: Fields) => !!vnpay.secret && equalSignature(fields.vnp_SecureHash || '', signVnpay(fields));
const date = (d: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(d).filter(p => p.type !== 'literal').reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
const formatDate = (d: Date) => { const p = date(d); return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`; };
export function vnpayUrl(txnRef: string, amount: string, orderId: string, ip: string, now: Date, expires: Date) {
  const fields: Fields = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: vnpay.tmnCode,
    vnp_Amount: amount, vnp_CurrCode: 'VND', vnp_TxnRef: txnRef,
    vnp_OrderInfo: `Thanh toan don ${orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
    vnp_OrderType: 'other', vnp_Locale: 'vn', vnp_ReturnUrl: `${appPublicUrl}/payment/result?provider=vnpay`,
    vnp_IpAddr: ip, vnp_CreateDate: formatDate(now), vnp_ExpireDate: formatDate(expires),
  };
  return `${vnpay.url}?${canonicalVnpay(fields)}&vnp_SecureHash=${signVnpay(fields)}`;
}
