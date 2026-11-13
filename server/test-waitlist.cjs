/** Chỉ chạy với DB tạm, MAIL_DRIVER=log; server/script dùng chung MAIL_OUTBOX_DIR. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const outbox = process.env.MAIL_OUTBOX_DIR;
const stamp = `${Date.now()}-${process.pid}`;
const users = [];
let eventId;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(endpoint, method, token, body, status = 200) {
  const response = await fetch(`${API}/${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
async function register(tag) {
  const email = `wait-${tag}-${stamp}@test.local`;
  const body = { email, password: 'MatKhauTest12345', fullName: 'Người chờ vé' };
  const { user } = await call('auth/register', 'POST', null, body, 201);
  users.push({ id: user.id, email });
  const { token } = await call('auth/login', 'POST', null, body);
  return { ...user, email, token };
}
async function mails() {
  const result = [];
  for (const file of await fs.readdir(outbox)) {
    if (!file.endsWith('.json')) continue;
    const mail = await fs.readFile(path.join(outbox, file), 'utf8').then(JSON.parse).catch(() => null);
    if (mail?.subject === `Có vé trả lại: <Sự kiện & ${stamp}>`) result.push(mail);
  }
  return result;
}
async function expectRecipients(expected) {
  for (let i = 0; i < 50 && (await mails()).length < expected.length; i++) await pause(100);
  await pause(300);
  const received = await mails();
  assert.deepEqual(received.map(mail => mail.to).sort(), [...expected].sort());
  for (const mail of received) {
    assert.ok(mail.text.includes('Ai đặt trước sẽ được trước'));
    assert.ok(mail.text.includes(`/events/wait-${stamp}`));
    assert.ok(mail.html.includes('&lt;Sự kiện &amp;'));
    assert.ok(mail.html.includes('&lt;Vé &amp; thường&gt;'));
  }
}
async function main() {
  assert.ok(outbox, 'Cần MAIL_OUTBOX_DIR dùng chung với server');
  assert.equal(process.env.MAIL_DRIVER || 'log', 'log');
  // Chặn nhầm DB ngoài máy cục bộ; vẫn cần trỏ DATABASE_URL sang DB tạm riêng.
  const database = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname), 'Chỉ chạy với database tạm cục bộ');
  await fs.mkdir(outbox, { recursive: true });
  const buyer = await register('buyer');
  const a = await register('a'), b = await register('b'), c = await register('c');
  const event = await prisma.event.create({ data: {
    slug: `wait-${stamp}`, title: `<Sự kiện & ${stamp}>`, location: 'Kiểm thử', organizerId: buyer.id,
    startTime: new Date(Date.now() + 48 * 3600_000), endTime: new Date(Date.now() + 49 * 3600_000),
    ticketTypes: { create: { name: '<Vé & thường>', price: 100, totalQuantity: 3, availableQuantity: 3 } },
  }, include: { ticketTypes: true } });
  eventId = event.id;
  const ticketTypeId = event.ticketTypes[0].id;
  const endpoint = `ticket-types/${ticketTypeId}/waitlist`;
  const join = user => call(endpoint, 'POST', user.token, {}, 201);
  const leave = user => call(endpoint, 'DELETE', user.token);
  const mine = user => call(`events/${eventId}/waitlist/me`, 'GET', user.token);
  const buy = async quantity => (await call('orders', 'POST', buyer.token, { ticketTypeId, quantity }, 201)).order;
  const cancel = order => call(`orders/${order.id}/cancel`, 'POST', buyer.token, {});
  await call(endpoint, 'POST', a.token, {}, 409);
  const two = await buy(2), one = await buy(1);
  for (const user of [a, b, c]) { await join(user); await pause(20); }
  assert.deepEqual((await mine(a)).data.ticketTypeIds, [ticketTypeId]);
  await cancel(two);
  await expectRecipients([a.email, b.email]);
  assert.deepEqual((await mine(a)).data.ticketTypeIds, []);
  assert.deepEqual((await mine(c)).data.ticketTypeIds, [ticketTypeId]);
  await cancel(one);
  await expectRecipients([a.email, b.email, c.email]);
  await cancel(one);
  await expectRecipients([a.email, b.email, c.email]);
  // Mua hết lại; người đã được báo đăng ký lại phải về cuối hàng.
  const held = await buy(3);
  await join(a); await pause(20);
  const previouslyNotified = await prisma.waitlistEntry.findUniqueOrThrow({ where: { ticketTypeId_userId: { ticketTypeId, userId: b.id } } });
  assert.ok(previouslyNotified.notifiedAt);
  await join(b);
  const rejoined = await prisma.waitlistEntry.findUniqueOrThrow({ where: { ticketTypeId_userId: { ticketTypeId, userId: b.id } } });
  assert.equal(rejoined.notifiedAt, null);
  assert.ok(rejoined.createdAt > previouslyNotified.createdAt);
  // Đăng ký lặp khi chưa được báo không đổi vị trí.
  await join(a);
  await leave(a); await leave(a);
  await join(a);
  const queue = await prisma.waitlistEntry.findMany({ where: { ticketTypeId, notifiedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  assert.deepEqual(queue.map(entry => entry.userId), [b.id, a.id]);
  await leave(a);
  await cancel(held);
  await expectRecipients([a.email, b.email, c.email, b.email]);
  assert.equal(await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } }).then(t => t.availableQuantity), 3);
  // Đơn đặt thành công xoá entry của chính người mua sau commit.
  await buy(3);
  await join(buyer);
  const released = await prisma.order.findFirstOrThrow({ where: { userId: buyer.id, status: 'PENDING' } });
  await cancel(released);
  await buy(1);
  for (let i = 0; i < 50 && await prisma.waitlistEntry.count({ where: { ticketTypeId, userId: buyer.id } }); i++) await pause(100);
  assert.equal(await prisma.waitlistEntry.count({ where: { ticketTypeId, userId: buyer.id } }), 0);
  console.log('PASS: danh sách chờ, FIFO, rời/đăng ký lại, email một lần và không giữ kho');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const ids = users.map(user => user.id);
  if (ids.length) await prisma.order.deleteMany({ where: { userId: { in: ids } } });
  if (eventId) await prisma.event.delete({ where: { id: eventId } });
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (outbox) for (const file of await fs.readdir(outbox).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(outbox, file);
    const mail = await fs.readFile(fullPath, 'utf8').then(JSON.parse).catch(() => null);
    if (users.some(user => user.email === mail?.to)) await fs.unlink(fullPath);
  }
  await prisma.$disconnect();
});
