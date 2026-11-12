/** Chỉ chạy với server, MySQL tạm và Redis; không chạy trên database thật. */
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const stamp = `${Date.now()}-${process.pid}`;
let user, eventId;
async function request(endpoint, method = 'GET', body, token) {
  const response = await fetch(`${API}${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  const password = 'MatKhauTest12345';
  user = await prisma.user.create({ data: {
    email: `sale-${stamp}@test.local`, password: await bcrypt.hash(password, 4), fullName: 'Kiểm tra mở bán', role: 'ORGANIZER',
  } });
  const login = await request('/auth/login', 'POST', { email: user.email, password });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const now = Date.now();
  const iso = offset => new Date(now + offset).toISOString();
  const payload = {
    title: 'Hội thảo Đà Nẵng', location: 'Đà Nẵng', description: '<Nội dung & chia sẻ>',
    startTime: iso(48 * 3600_000), endTime: iso(49 * 3600_000),
    ticketTypes: [
      { name: 'Chưa mở', price: 100, totalQuantity: 10, saleStart: iso(3600_000), saleEnd: iso(7200_000) },
      { name: 'Đã ngừng', price: 100, totalQuantity: 10, saleStart: iso(-7200_000), saleEnd: iso(-3600_000) },
      { name: 'Đang bán', price: 100, totalQuantity: 10, saleStart: iso(-3600_000), saleEnd: iso(3600_000) },
    ],
  };
  const created = await request('/events', 'POST', payload, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const event = created.body.event;
  eventId = event.id;
  assert.match(event.slug, /^hoi-thao-da-nang-[a-z0-9]{6}$/);
  for (const [name, message] of [['Chưa mở', 'Loại vé này chưa mở bán!'], ['Đã ngừng', 'Loại vé này đã ngừng bán!']]) {
    const ticket = event.ticketTypes.find(t => t.name === name);
    const booked = await request('/orders', 'POST', { ticketTypeId: ticket.id, quantity: 1 }, token);
    assert.equal(booked.status, 409, JSON.stringify(booked.body));
    assert.equal(booked.body.message, message);
    if (name === 'Chưa mở') assert.equal(booked.body.saleStart, payload.ticketTypes[0].saleStart);
    assert.equal((await prisma.ticketType.findUniqueOrThrow({ where: { id: ticket.id } })).availableQuantity, 10);
  }
  const ticket = event.ticketTypes.find(t => t.name === 'Đang bán');
  const booked = await request('/orders', 'POST', { ticketTypeId: ticket.id, quantity: 1 }, token);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal((await prisma.ticketType.findUniqueOrThrow({ where: { id: ticket.id } })).availableQuantity, 9);
  const byId = await request(`/events/${event.id}`);
  const bySlug = await request(`/events/${event.slug}`);
  assert.equal(byId.status, 200);
  assert.equal(bySlug.status, 200);
  assert.deepEqual(bySlug.body.data, byId.body.data);
  const updated = await request(`/events/${event.id}`, 'PUT', { ...payload, title: 'Tiêu đề mới', ticketTypes: undefined }, token);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.event.slug, event.slug);
  for (const key of [event.id, event.slug]) {
    const loaded = await request(`/events/${key}`);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.data.title, 'Tiêu đề mới');
    assert.equal(loaded.body.data.slug, event.slug);
  }
  const invalid = await request('/events', 'POST', { ...payload, ticketTypes: [{ ...payload.ticketTypes[0], saleEnd: payload.ticketTypes[0].saleStart }] }, token);
  assert.equal(invalid.status, 400);
  const afterEvent = await request('/events', 'POST', { ...payload, ticketTypes: [{ ...payload.ticketTypes[0], saleEnd: iso(50 * 3600_000) }] }, token);
  assert.equal(afterEvent.status, 400);
  console.log('PASS: cửa sổ bán vé, tồn kho, slug và cache theo ID/slug');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    if (user) await prisma.order.deleteMany({ where: { userId: user.id } });
    if (eventId) await prisma.event.delete({ where: { id: eventId } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
  } finally { await prisma.$disconnect(); }
});
