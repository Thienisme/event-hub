import { isSimulatedPaymentEnabled } from './order';
export const appPublicUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
export const apiPublicUrl = (process.env.API_PUBLIC_URL || appPublicUrl).replace(/\/$/, '');
const hold = Number(process.env.PAYMENT_HOLD_MINUTES ?? 15);
export const PAYMENT_HOLD_MINUTES = Number.isFinite(hold) && hold > 0 ? hold : 15;
export const vnpay = {
  tmnCode: process.env.VNPAY_TMN_CODE || '', secret: process.env.VNPAY_HASH_SECRET || '',
  url: process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
};
export const momo = {
  partnerCode: process.env.MOMO_PARTNER_CODE || '', accessKey: process.env.MOMO_ACCESS_KEY || '',
  secret: process.env.MOMO_SECRET_KEY || '',
  endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
};
export const enabledProviders = (): string[] => [
  ...(isSimulatedPaymentEnabled() ? ['MOCK'] : []),
  ...(vnpay.tmnCode && vnpay.secret ? ['VNPAY'] : []),
  ...(momo.partnerCode && momo.accessKey && momo.secret ? ['MOMO'] : []),
];
