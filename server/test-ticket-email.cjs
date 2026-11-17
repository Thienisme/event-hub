/** Chỉ chạy với DB tạm, MAIL_DRIVER=log và MAIL_OUTBOX_DIR dùng chung với server. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('ts-node/register');
const prisma = require('./src/utils/prisma').default;
const { sweepEventReminders } = require('./src/jobs/eventReminder.job');
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const outbox = process.env.MAIL_OUTBOX_DIR;
const stamp = `${Date.now()}-${process.pid}`;
const email = `ticket-${stamp}@test.local`;
let userId, eventId, orderId;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(endpoint, body, token) {
  const response = await fetch(`${API}/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function mails(subject) {
  const result = [];
  for (const file of await fs.readdir(outbox)) {
    if (!file.endsWith('.json')) continue;
    const mail = await fs.readFile(path.join(outbox, file), 'utf8').then(JSON.parse).catch(() => null);
    if (mail?.to === email && mail.subject === subject) result.push(mail);
  }
  return result;
}
async function main() {
  assert.ok(outbox, 'Cần MAIL_OUTBOX_DIR dùng chung với server');
  assert.equal(process.env.MAIL_DRIVER || 'log', 'log');
  await fs.mkdir(outbox, { recursive: true });
  const registered = await call('auth/register', { email, password: 'MatKhauTest12345', fullName: 'Người mua vé' });
  userId = registered.user.id;
  const { token } = await call('auth/login', { email, password: 'MatKhauTest12345' });
  const event = await prisma.event.create({ data: {
    slug: `su-kien-${stamp}`,
    title: '<Sự kiện & thử nghiệm>', location: '<Địa điểm>', organizerId: userId,
    startTime: new Date(Date.now() + 48 * 3600_000), endTime: new Date(Date.now() + 49 * 3600_000),
    ticketTypes: { create: { name: '<Vé & thường>', price: 100, totalQuantity: 10, availableQuantity: 10 } },
  }, include: { ticketTypes: true } });
  eventId = event.id;
  const created = await call('orders', { ticketTypeId: event.ticketTypes[0].id, quantity: 2 }, token);
  orderId = created.order.id;
  const confirmed = await call(`orders/${orderId}/confirm`, {}, token);
  const subject = 'Vé của bạn đã được thanh toán';
  for (let i = 0; i < 100 && (await mails(subject)).length === 0; i++) await pause(50);
  const ticketMails = await mails(subject);
  assert.equal(ticketMails.length, 1);
  for (const ticket of confirmed.order.tickets) {
    assert.ok(ticket.qrCode);
    assert.ok(ticketMails[0].text.includes(ticket.qrCode));
    assert.ok(ticketMails[0].html.includes(ticket.qrCode));
  }
  assert.ok(ticketMails[0].html.includes('&lt;Sự kiện &amp; thử nghiệm&gt;'));
  assert.ok(ticketMails[0].text.includes('/my-orders'));
  await call(`orders/${orderId}/confirm`, {}, token);
  await pause(500);
  assert.equal((await mails(subject)).length, 1);
  await prisma.event.update({ where: { id: eventId }, data: {
    startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 7200_000),
  } });
  // Hai worker cùng quét vẫn chỉ một bên chiếm được đơn.
  await Promise.all([sweepEventReminders(), sweepEventReminders()]);
  const reminderSubject = 'Nhắc lịch sự kiện trong 24 giờ tới';
  assert.equal((await mails(reminderSubject)).length, 1);
  assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).reminderSentAt);
  await sweepEventReminders();
  assert.equal((await mails(reminderSubject)).length, 1);
  console.log('PASS: email vé và nhắc lịch chỉ gửi một lần, đúng người và mã vé');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (orderId) await prisma.order.delete({ where: { id: orderId } });
  if (eventId) await prisma.event.delete({ where: { id: eventId } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  if (outbox) for (const file of await fs.readdir(outbox).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(outbox, file);
    const mail = await fs.readFile(fullPath, 'utf8').then(JSON.parse).catch(() => null);
    if (mail?.to === email) await fs.unlink(fullPath);
  }
  await prisma.$disconnect();
});
