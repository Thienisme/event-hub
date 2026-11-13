/** Chỉ chạy với MySQL tạm; cùng DATABASE_URL với server. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const assert = require('node:assert/strict');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const users = [];
let event;
const stamp = Date.now();
async function user(tag) {
  const email = `promo-${tag}-${stamp}@test.local`;
  const row = await prisma.user.create({ data: { email, password: await bcrypt.hash('MatKhau123!', 4), fullName: 'Thử mã', role: 'ORGANIZER' } });
  users.push(row.id);
  const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'MatKhau123!' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  return { id: row.id, token: body.token };
}
async function api(who, method, path, data) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` }, body: data === undefined ? undefined : JSON.stringify(data) });
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
  const unused = await create('DELETE');
  assert.equal((await api(owner, 'DELETE', `/promo-codes/${unused.id}`)).status, 200);
  console.log('✅ CRUD, quyền, tiền, preview, tranh chấp và trả lượt mã giảm giá');
}
async function cleanup() {
  await prisma.order.deleteMany({ where: { userId: { in: users } } });
  if (event) await prisma.event.delete({ where: { id: event.id } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { try { await cleanup(); } finally { await prisma.$disconnect(); } });
