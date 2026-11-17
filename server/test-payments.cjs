/** Chỉ chạy với database MySQL tạm và server dùng cùng cấu hình sandbox. Không nạp .env. */
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(database.hostname) || !/(test|tmp|temp)/i.test(database.pathname)) {
  throw new Error('Test thanh toán yêu cầu DATABASE_URL cục bộ có tên database chứa test/tmp/temp.');
}
const prisma = new PrismaClient();
const secret = process.env.VNPAY_HASH_SECRET || 'testsecret';
const tmn = process.env.VNPAY_TMN_CODE || 'TESTTMN';
const momoSecret = process.env.MOMO_SECRET_KEY || 'testmomosecret';
const accessKey = process.env.MOMO_ACCESS_KEY || 'testaccess';
const partnerCode = process.env.MOMO_PARTNER_CODE || 'MOMO';
const encode = s => encodeURIComponent(s).replace(/%20/g, '+');
const vnpSign = p => createHmac('sha512', secret).update(Object.keys(p).filter(k => k.startsWith('vnp_') && !['vnp_SecureHash','vnp_SecureHashType'].includes(k)).sort().map(k => `${encode(k)}=${encode(p[k])}`).join('&')).digest('hex');
const momoSign = p => createHmac('sha256', momoSecret).update(['accessKey','amount','extraData','message','orderId','orderInfo','orderType','partnerCode','payType','requestId','responseTime','resultCode','transId'].map(k => `${k}=${k === 'accessKey' ? accessKey : p[k]}`).join('&')).digest('hex');
let user, event, token;
async function api(method, path, data) {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}
async function book(code) {
  const r = await api('POST', '/orders', { ticketTypeId: event.ticketTypes[0].id, quantity: 1, ...(code ? { promoCode: code } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.order;
}
async function pay(order) {
  const r = await api('POST', `/orders/${order.id}/pay`, { provider: 'VNPAY' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = Object.fromEntries(new URL(r.body.data.paymentUrl).searchParams);
  assert.equal(p.vnp_SecureHash, vnpSign(p));
  assert.equal(p.vnp_Amount, String(Number(order.totalAmount) * 100));
  return p;
}
function callback(p, extra = {}) {
  const f = { vnp_TmnCode: tmn, vnp_TxnRef: p.vnp_TxnRef, vnp_Amount: p.vnp_Amount, vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '123456', ...extra };
  return { ...f, vnp_SecureHash: vnpSign(f) };
}
const ipn = f => api('GET', `/payments/vnpay/ipn?${new URLSearchParams(f)}`);
const read = id => prisma.order.findUniqueOrThrow({ where: { id }, include: { tickets: true } });
async function main() {
  const stamp = randomBytes(8).toString('hex');
  user = await prisma.user.create({ data: { email: `payment-${stamp}@test.local`, password: await bcrypt.hash('TestPayment123!', 4), fullName: 'Thử thanh toán', role: 'ORGANIZER' } });
  const login = await api('POST', '/auth/login', { email: user.email, password: 'TestPayment123!' });
  assert.equal(login.status, 200); token = login.body.token;
  event = await prisma.event.create({ data: { slug: `payment-${stamp}`, title: 'Thử thanh toán', location: 'HN', organizerId: user.id,
    startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 172800000),
    ticketTypes: { create: { name: 'Vé', price: 150000, totalQuantity: 100, availableQuantity: 100 } } }, include: { ticketTypes: true } });
  const o = await book(); const p = await pay(o);
  assert.ok(new Date((await read(o.id)).expiresAt) > new Date(o.expiresAt));
  assert.equal((await ipn({ ...callback(p), vnp_SecureHash: 'bad' })).body.RspCode, '97');
  assert.equal((await ipn(callback(p, { vnp_Amount: '1' }))).body.RspCode, '04');
  assert.equal((await read(o.id)).status, 'PENDING');
  const f = callback(p);
  assert.equal((await ipn(f)).body.RspCode, '00');
  const paid = await read(o.id); assert.equal(paid.status, 'CONFIRMED'); assert.ok(paid.tickets[0].qrCode);
  assert.equal((await ipn(f)).body.RspCode, '02');
  assert.deepEqual((await read(o.id)).tickets.map(t => t.qrCode), paid.tickets.map(t => t.qrCode));
  const ret = await api('GET', `/payments/vnpay/return?${new URLSearchParams(f)}`); assert.equal(ret.body.data.status, 'SUCCEEDED');
  assert.equal((await api('GET', `/payments/vnpay/return?${new URLSearchParams({ ...f, vnp_SecureHash: 'bad' })}`)).status, 400);
  const failedOrder = await book(), failedPay = await pay(failedOrder);
  assert.equal((await ipn(callback(failedPay, { vnp_ResponseCode: '24' }))).body.RspCode, '00');
  assert.equal((await prisma.payment.findUnique({ where: { txnRef: failedPay.vnp_TxnRef } })).status, 'FAILED');
  assert.equal((await read(failedOrder.id)).status, 'PENDING');
  const race = await book(), racePay = await pay(race);
  const results = await Promise.all(Array.from({ length: 10 }, () => ipn(callback(racePay))));
  assert.equal(results.filter(r => r.body.RspCode === '00').length, 1);
  assert.equal(results.filter(r => r.body.RspCode === '02').length, 9);
  const qr = (await read(race.id)).tickets[0].qrCode; assert.ok(qr);
  assert.equal((await read(race.id)).tickets[0].qrCode, qr);
  const cancelled = await book(), cp = await pay(cancelled);
  assert.equal((await api('POST', `/orders/${cancelled.id}/cancel`)).status, 200);
  const stock = (await prisma.ticketType.findUnique({ where: { id: event.ticketTypes[0].id } })).availableQuantity;
  assert.equal((await ipn(callback(cp))).body.RspCode, '00');
  assert.equal((await read(cancelled.id)).status, 'CANCELLED');
  assert.equal((await prisma.payment.findUnique({ where: { txnRef: cp.vnp_TxnRef } })).needsRefund, true);
  assert.equal((await prisma.ticketType.findUnique({ where: { id: event.ticketTypes[0].id } })).availableQuantity, stock);
  const limit = await book(); await Promise.all([pay(limit), pay(limit), pay(limit)]);
  assert.equal((await api('POST', `/orders/${limit.id}/pay`, { provider: 'VNPAY' })).status, 409);
  const mo = await book(), txnRef = randomBytes(10).toString('hex');
  await prisma.payment.create({ data: { orderId: mo.id, provider: 'MOMO', txnRef, amount: mo.totalAmount } });
  const mf = { partnerCode, amount: String(mo.totalAmount), extraData: '', message: 'Successful.', orderId: txnRef, orderInfo: 'Thanh toan', orderType: 'momo_wallet', payType: 'qr', requestId: txnRef, responseTime: String(Date.now()), resultCode: '0', transId: '123456' };
  mf.signature = momoSign(mf);
  assert.equal((await api('POST', '/payments/momo/ipn', { ...mf, amount: Number(mf.amount), resultCode: 0, transId: 123456, responseTime: Number(mf.responseTime) })).status, 204);
  assert.equal((await read(mo.id)).status, 'CONFIRMED');
  assert.equal((await api('GET', `/payments/momo/return?${new URLSearchParams(mf)}`)).body.data.status, 'SUCCEEDED');
  await prisma.promoCode.create({ data: { eventId: event.id, code: 'FREE', discountType: 'FIXED', discountValue: 999999 } });
  const free = await book('FREE');
  const freeResult = await api('POST', `/orders/${free.id}/pay`, { provider: 'VNPAY' });
  assert.equal(freeResult.status, 200); assert.equal(freeResult.body.data.order.status, 'CONFIRMED');
  assert.ok(freeResult.body.data.order.tickets[0].qrCode); assert.equal(freeResult.body.data.paymentUrl, undefined);
  assert.equal(await prisma.payment.count({ where: { orderId: free.id } }), 0);
  console.log('✅ Thanh toán: chữ ký, số tiền, gửi lặp, tranh chấp, hoàn tiền, return, giới hạn và đơn 0đ');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  try {
    if (user) await prisma.order.deleteMany({ where: { userId: user.id } });
    if (event) await prisma.event.delete({ where: { id: event.id } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
  } finally { await prisma.$disconnect(); }
});
