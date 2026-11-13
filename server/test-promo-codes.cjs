/** Chỉ chạy với MySQL tạm; cùng DATABASE_URL với server. */
const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(database.hostname) || !/(test|tmp|temp)/i.test(database.pathname)) {
  throw new Error('Test mã giảm giá yêu cầu DATABASE_URL cục bộ có tên database chứa test/tmp/temp.');
}
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const assert = require('node:assert/strict');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const users = [];
let event;
const stamp = Date.now();
/**
 * Bộ test này gửi hơn 100 request, vượt apiRateLimiter (100/phút) nếu chạy liền một mạch.
 * Tự đếm request trong cửa sổ 60 giây (không dựa vào header RateLimit-*, vì orderRateLimiter
 * ghi đè header đó trên route đặt vé). Gần chạm 85 thì chờ hết cửa sổ, để các loạt 10 request
 * đồng thời (tranh chấp mã) luôn đủ hạn mức và thật sự chạy cùng lúc. Gặp 429 thì chờ rồi thử lại.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const WINDOW_MS = 61_000, BUDGET = 85;
let windowStart = Date.now(), sent = 0, quotaWait = null;
async function takeQuota() {
  for (;;) {
    if (quotaWait) { await quotaWait; continue; }
    if (Date.now() - windowStart >= WINDOW_MS) { windowStart = Date.now(); sent = 0; }
    if (sent < BUDGET) { sent++; return; }
    quotaWait = pause(windowStart + WINDOW_MS - Date.now()).then(() => { quotaWait = null; });
  }
}
async function quotaFetch(url, options) {
  for (let attempt = 0; ; attempt++) {
    await takeQuota();
    const res = await fetch(url, options);
    if (res.status !== 429 || attempt >= 2) return res;
    sent = BUDGET; // server báo hết: chờ sang cửa sổ mới rồi thử lại
  }
}
async function user(tag) {
  const email = `promo-${tag}-${stamp}@test.local`;
  const row = await prisma.user.create({ data: { email, password: await bcrypt.hash('MatKhau123!', 4), fullName: 'Thử mã', role: 'ORGANIZER' } });
  users.push(row.id);
  const response = await quotaFetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'MatKhau123!' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  return { id: row.id, token: body.token };
}
async function api(who, method, path, data) {
  const res = await quotaFetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json() };
}
async function main() {
  const owner = await user('owner');
  const buyers = [];
  for (let i = 0; i < 10; i++) buyers.push(await user(i));
  event = await prisma.event.create({ data: {
    slug: `promo-${stamp}`, title: 'Thử mã giảm giá', location: 'HN', organizerId: owner.id,
    startTime: new Date(Date.now() + 86400000), endTime: new Date(Date.now() + 172800000),
    // Mỗi người một loại vé để tranh chấp thực sự ở mã, không xếp hàng qua Redlock.
    ticketTypes: { create: Array.from({ length: 10 }, (_, i) => ({ name: `Vé ${i}`, price: 150000, totalQuantity: 100, availableQuantity: 100 })) },
  }, include: { ticketTypes: true } });
  const path = `/events/${event.id}/promo-codes`;
  const create = async (code, extra = {}) => {
    const r = await api(owner, 'POST', path, { code, discountType: 'PERCENT', discountValue: 15, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const percent = await create(' save15 ');
  assert.equal(percent.code, 'SAVE15');
  assert.equal((await api(owner, 'POST', path, { code: 'save15', discountType: 'FIXED', discountValue: 1 })).status, 409);
  assert.equal((await api(buyers[0], 'GET', path)).status, 403);
  assert.equal((await api(buyers[0], 'PATCH', `/promo-codes/${percent.id}`, { active: false })).status, 403);
  assert.equal((await api(buyers[0], 'DELETE', `/promo-codes/${percent.id}`)).status, 403);
  const list = await api(owner, 'GET', path);
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some(p => p.id === percent.id));
  assert.equal((await api(owner, 'PATCH', `/promo-codes/${percent.id}`, { perUserLimit: 1 })).status, 200);
  const preview = await api(buyers[0], 'POST', '/promo-codes/preview', { code: 'save15', ticketTypeId: event.ticketTypes[0].id, quantity: 3 });
  assert.equal(preview.status, 200);
  assert.equal(Number(preview.body.data.discountAmount), 67500);
  assert.equal((await prisma.promoCode.findUnique({ where: { id: percent.id } })).usedCount, 0);
  const book = (who, type, code, quantity = 1) => api(who, 'POST', '/orders', { ticketTypeId: type.id, quantity, promoCode: code });
  const order = await book(buyers[0], event.ticketTypes[0], 'save15', 3);
  assert.equal(order.status, 201);
  assert.equal(order.body.order.promoCodeId, percent.id);
  assert.equal(Number(order.body.order.subtotalAmount), 450000);
  assert.equal(Number(order.body.order.discountAmount), 67500);
  assert.equal(Number(order.body.order.totalAmount), 382500);
  assert.equal((await book(buyers[0], event.ticketTypes[0], 'SAVE15')).status, 400);
  const limitPreview = await api(buyers[0], 'POST', '/promo-codes/preview', { code: 'SAVE15', ticketTypeId: event.ticketTypes[0].id, quantity: 1 });
  assert.equal(limitPreview.status, 400);
  assert.equal((await api(owner, 'DELETE', `/promo-codes/${percent.id}`)).status, 409);
  const fixed = await create('FIXED', { discountType: 'FIXED', discountValue: 999999 });
  const free = await book(buyers[1], event.ticketTypes[1], fixed.code);
  assert.equal(free.status, 201);
  assert.equal(Number(free.body.order.totalAmount), 0);
  assert.equal(Number(free.body.order.discountAmount), 150000);
  const race = await create('RACE', { maxUses: 3 });
  const before = await prisma.ticketType.findMany({ where: { eventId: event.id } });
  const results = await Promise.all(buyers.map((who, i) => book(who, event.ticketTypes[i], race.code)));
  assert.equal(results.filter(r => r.status === 201).length, 3, JSON.stringify(results));
  assert.equal(results.filter(r => r.status === 400).length, 7);
  assert.equal((await prisma.promoCode.findUnique({ where: { id: race.id } })).usedCount, 3);
  assert.equal(await prisma.order.count({ where: { promoCodeId: race.id } }), 3);
  const after = await prisma.ticketType.findMany({ where: { eventId: event.id } });
  assert.equal(before.reduce((n, t) => n + t.availableQuantity, 0) - after.reduce((n, t) => n + t.availableQuantity, 0), 3);
  assert.equal((await api(owner, 'PATCH', `/promo-codes/${race.id}`, { maxUses: 2 })).status, 409);
  const winner = results.findIndex(r => r.status === 201);
  const winnerOrder = results[winner].body.order;
  assert.equal((await api(buyers[winner], 'POST', `/orders/${winnerOrder.id}/cancel`)).status, 200);
  assert.equal((await api(buyers[winner], 'POST', `/orders/${winnerOrder.id}/cancel`)).status, 200);
  assert.equal((await prisma.promoCode.findUnique({ where: { id: race.id } })).usedCount, 2);
  const loser = results.findIndex(r => r.status === 400);
  assert.equal((await book(buyers[loser], event.ticketTypes[loser], race.code)).status, 201);
  assert.equal((await prisma.promoCode.findUnique({ where: { id: race.id } })).usedCount, 3);
  // Checkout: xem đơn, đổi mã, hạn mức và chặn sửa sau thanh toán.
  const checkoutPromo = await create('CHECKOUT', { maxUses: 1 });
  const replacement = await create('REPLACE', { discountType: 'FIXED', discountValue: 10000 });
  const pending = await book(buyers[0], event.ticketTypes[0]);
  assert.equal(pending.status, 201);
  const checkoutPath = `/orders/${pending.body.order.id}`;
  const own = await api(buyers[0], 'GET', checkoutPath);
  assert.equal(own.status, 200);
  assert.equal(own.body.data.promoCode, null);
  assert.equal(own.body.data.paymentStarted, false);
  assert.equal(own.body.data.tickets[0].ticketType.event.slug, event.slug);
  assert.equal((await api(buyers[1], 'GET', checkoutPath)).status, 404);
  assert.equal((await api(buyers[1], 'POST', `${checkoutPath}/promo`, { code: checkoutPromo.code })).status, 404);
  assert.equal((await api(buyers[1], 'DELETE', `${checkoutPath}/promo`)).status, 404);
  for (const code of ['AB', 'A'.repeat(33), 'BAD CODE']) {
    assert.equal((await api(buyers[0], 'POST', `${checkoutPath}/promo`, { code })).status, 400);
  }
  const usage = async promo => (await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } })).usedCount;
  const apply = (who, id, code) => api(who, 'POST', `/orders/${id}/promo`, { code });
  const applied = await apply(buyers[0], pending.body.order.id, ' checkout ');
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.data.promoCode, 'CHECKOUT');
  assert.equal(Number(applied.body.data.totalAmount), 127500);
  assert.equal(await usage(checkoutPromo), 1);
  assert.equal((await apply(buyers[0], pending.body.order.id, checkoutPromo.code)).status, 200);
  assert.equal(await usage(checkoutPromo), 1);
  const changed = await apply(buyers[0], pending.body.order.id, replacement.code);
  assert.equal(changed.status, 200);
  assert.equal(Number(changed.body.data.totalAmount), 140000);
  assert.equal(await usage(checkoutPromo), 0);
  assert.equal(await usage(replacement), 1);
  const second = await book(buyers[0], event.ticketTypes[0]);
  assert.equal(second.status, 201);
  assert.equal((await apply(buyers[0], second.body.order.id, replacement.code)).status, 400);
  assert.equal((await apply(buyers[0], pending.body.order.id, replacement.code)).status, 200);
  const removed = await api(buyers[0], 'DELETE', `${checkoutPath}/promo`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.data.promoCode, null);
  assert.equal(removed.body.data.promoCodeId, null);
  assert.equal(Number(removed.body.data.discountAmount), 0);
  assert.equal(Number(removed.body.data.totalAmount), Number(removed.body.data.subtotalAmount));
  assert.equal(await usage(replacement), 0);
  assert.equal((await api(buyers[0], 'DELETE', `${checkoutPath}/promo`)).status, 200);

  const applyRace = await create('APPLYRACE', { maxUses: 3 });
  const waiting = [];
  for (let i = 0; i < buyers.length; i++) {
    const r = await book(buyers[i], event.ticketTypes[i]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    waiting.push(r.body.order);
  }
  const appliedRace = await Promise.all(buyers.map((who, i) => apply(who, waiting[i].id, applyRace.code)));
  assert.equal(appliedRace.filter(r => r.status === 200).length, 3, JSON.stringify(appliedRace));
  assert.equal(appliedRace.filter(r => r.status === 400).length, 7);
  assert.equal(await usage(applyRace), 3);
  assert.equal(await prisma.order.count({ where: { promoCodeId: applyRace.id } }), 3);

  assert.equal((await apply(buyers[0], pending.body.order.id, checkoutPromo.code)).status, 200);
  const payment = await api(buyers[0], 'POST', `${checkoutPath}/pay`, { provider: 'VNPAY' });
  assert.equal(payment.status, 200, 'Cần bật VNPAY sandbox: ' + JSON.stringify(payment.body));
  assert.ok(payment.body.data.paymentUrl);
  assert.equal((await api(buyers[0], 'GET', checkoutPath)).body.data.paymentStarted, true);
  for (const result of [
    await apply(buyers[0], pending.body.order.id, replacement.code),
    await apply(buyers[0], pending.body.order.id, checkoutPromo.code),
    await api(buyers[0], 'DELETE', `${checkoutPath}/promo`),
  ]) {
    assert.equal(result.status, 409);
    assert.equal(result.body.message, 'Đơn đã bắt đầu thanh toán, không thể đổi mã giảm giá!');
  }
  assert.equal(await usage(checkoutPromo), 1);
  const cancelledPath = `/orders/${second.body.order.id}`;
  assert.equal((await api(buyers[0], 'POST', `${cancelledPath}/cancel`)).status, 200);
  assert.equal((await apply(buyers[0], second.body.order.id, replacement.code)).status, 409);
  assert.equal((await api(buyers[0], 'DELETE', `${cancelledPath}/promo`)).status, 409);
  await prisma.order.update({ where: { id: waiting[1].id }, data: { expiresAt: new Date(0) } });
  assert.equal((await apply(buyers[1], waiting[1].id, replacement.code)).status, 409);
  assert.equal((await api(buyers[1], 'DELETE', `/orders/${waiting[1].id}/promo`)).status, 409);
  // Ưu đãi công khai: không làm lộ mã riêng hoặc trường quản trị.
  const offersPath = `/events/${event.id}/offers`;
  const offers = async (who, path) => {
    const r = await api(who, 'GET', path);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const item of r.body.data) {
      assert.deepEqual(Object.keys(item).sort(),
        ['code', 'discountType', 'discountValue', 'endsAt', 'remainingUses',
          ...(path.startsWith('/orders/') ? ['discountAmount'] : [])].sort());
      assert.equal(typeof item.discountValue, 'string');
    }
    return r.body.data;
  };
  const offerOrder = await book(buyers[8], event.ticketTypes[8]);
  assert.equal(offerOrder.status, 201);
  const orderOffersPath = `/orders/${offerOrder.body.order.id}/offers`;
  const privatePromo = await create('PRIVATE', { maxUses: 8 });
  assert.equal(privatePromo.isPublic, false);
  assert.deepEqual(await offers(null, offersPath), []);
  assert.deepEqual(await offers(buyers[8], orderOffersPath), []);
  assert.equal((await api(owner, 'PATCH', `/promo-codes/${privatePromo.id}`, { isPublic: true })).status, 200);
  assert.equal((await offers(null, offersPath))[0].code, privatePromo.code);
  assert.equal((await offers(buyers[8], orderOffersPath))[0].code, privatePromo.code);
  const high = await create('PUBLIC50', { isPublic: true, discountValue: 50 });
  const bigFixed = await create('PUBLICFIXED', { isPublic: true, discountType: 'FIXED', discountValue: 999999 });
  await create('PUBLICSMALL', { isPublic: true, discountType: 'FIXED', discountValue: 1000 });
  await create('PUBLICZERO', { isPublic: true, discountValue: 1 });
  const off = await create('PUBLICOFF', { isPublic: true });
  assert.equal((await api(owner, 'PATCH', `/promo-codes/${off.id}`, { active: false })).status, 200);
  await create('PUBLICFUTURE', { isPublic: true, startsAt: new Date(Date.now() + 86400000).toISOString() });
  await create('PUBLICPAST', { isPublic: true, endsAt: new Date(Date.now() - 86400000).toISOString() });
  const exhausted = await create('PUBLICFULL', { isPublic: true, maxUses: 1 });
  await prisma.promoCode.update({ where: { id: exhausted.id }, data: { usedCount: 1 } });
  const eventOffers = await offers(null, offersPath);
  assert.deepEqual(eventOffers.map(p => p.code), ['PUBLIC50', 'PRIVATE', 'PUBLICZERO', 'PUBLICFIXED', 'PUBLICSMALL']);
  assert.equal(eventOffers.find(p => p.code === 'PRIVATE').remainingUses, 8);
  assert.equal(eventOffers[0].remainingUses, null);
  assert.equal((await api(null, 'GET', '/events/missing-event/offers')).status, 404);
  assert.equal((await api(buyers[9], 'GET', orderOffersPath)).status, 404);
  assert.equal((await api(null, 'GET', orderOffersPath)).status, 401);
  const orderOffers = await offers(buyers[8], orderOffersPath);
  assert.deepEqual(orderOffers.map(p => p.code), ['PUBLICFIXED', 'PUBLIC50', 'PRIVATE', 'PUBLICZERO', 'PUBLICSMALL']);
  assert.equal(Number(orderOffers[0].discountAmount), 150000);
  assert.equal(Number(orderOffers.find(p => p.code === high.code).discountAmount), 75000);
  const appliedOffer = await apply(buyers[8], offerOrder.body.order.id, high.code);
  assert.equal(appliedOffer.status, 200);
  assert.equal(Number(appliedOffer.body.data.discountAmount), Number(orderOffers.find(p => p.code === high.code).discountAmount));
  assert.equal(Number(appliedOffer.body.data.totalAmount), 75000);
  assert.ok((await offers(buyers[8], orderOffersPath)).some(p => p.code === high.code));
  const nextOrder = await book(buyers[8], event.ticketTypes[8]);
  assert.equal(nextOrder.status, 201);
  assert.ok(!(await offers(buyers[8], `/orders/${nextOrder.body.order.id}/offers`)).some(p => p.code === high.code));
  assert.equal((await apply(buyers[8], offerOrder.body.order.id, privatePromo.code)).status, 200);
  assert.equal((await offers(null, offersPath)).find(p => p.code === privatePromo.code).remainingUses, 7);
  assert.equal((await api(buyers[8], 'POST', `/orders/${nextOrder.body.order.id}/cancel`)).status, 200);
  assert.deepEqual(await offers(buyers[8], `/orders/${nextOrder.body.order.id}/offers`), []);
  assert.deepEqual(await offers(buyers[0], `${cancelledPath}/offers`), []);
  assert.deepEqual(await offers(buyers[1], `/orders/${waiting[1].id}/offers`), []);
  // Giá trị giảm bằng 0 không được liệt kê; ngày hết hạn gần hơn xếp trước, null cuối.
  await prisma.order.update({ where: { id: offerOrder.body.order.id }, data: { subtotalAmount: 1 } });
  const sooner = await create('PUBLICSOON', { isPublic: true, discountType: 'FIXED', discountValue: 2,
    endsAt: new Date(Date.now() + 3600000).toISOString() });
  const tinyOffers = await offers(buyers[8], orderOffersPath);
  assert.equal(tinyOffers[0].code, sooner.code);
  assert.ok(!tinyOffers.some(p => p.discountType === 'PERCENT'));
  assert.ok(tinyOffers.some(p => p.code === bigFixed.code && Number(p.discountAmount) === 1));
  for (let i = 0; i < 11; i++) {
    await prisma.promoCode.create({ data: { eventId: event.id, code: `PUBLICEXTRA${i}`, isPublic: true,
      discountType: 'FIXED', discountValue: 1 } });
  }
  assert.equal((await offers(null, offersPath)).length, 10);
  assert.equal((await offers(buyers[8], orderOffersPath)).length, 10);
  const unused = await create('DELETE');
  assert.equal((await api(owner, 'DELETE', `/promo-codes/${unused.id}`)).status, 200);
  console.log('✅ CRUD, quyền, tiền, preview, checkout, tranh chấp và trả lượt mã giảm giá');
}
async function cleanup() {
  await prisma.order.deleteMany({ where: { userId: { in: users } } });
  if (event) await prisma.event.delete({ where: { id: event.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
