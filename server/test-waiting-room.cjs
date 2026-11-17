/** Chỉ chạy với database tạm, server và script dùng cùng Redis/database. Khoảng 55 request. */
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const Redis = require('ioredis');
const prisma = new PrismaClient();
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379,
});
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const users = [], events = [];
const password = 'MatKhauDaiHon8KyTu';
async function request(user, path, method = 'GET', body) {
  const r = await fetch(`${API}${path}`, { method, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}`,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function user(role = 'CUSTOMER') {
  const email = `queue-${randomUUID()}@test.local`;
  const row = await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 4), fullName: 'Phòng chờ', role } });
  users.push(row.id);
  const login = await request(null, '/auth/login', 'POST', { email, password });
  assert.equal(login.status, 200);
  return { id: row.id, token: login.body.token };
}
async function main() {
  const database = new URL(process.env.DATABASE_URL).pathname;
  assert.match(database, /test|tmp|temp/i, 'Chỉ được dùng database tạm');
  const organizer = await user('ORGANIZER');
  const people = [];
  for (let i = 0; i < 6; i++) people.push(await user());
  const payload = { title: 'Phòng chờ kiểm thử', location: 'HN',
    startTime: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 172800000).toISOString(),
    queueEnabled: true, queueActiveLimit: 2,
    ticketTypes: [{ name: 'A', price: 1000, totalQuantity: 100 }] };
  const event = await prisma.event.create({ data: { ...payload, slug: `queue-${randomUUID()}`,
    organizerId: organizer.id, ticketTypes: { create: [{ name: 'A', price: 1000, totalQuantity: 100, availableQuantity: 100 }] } }, include: { ticketTypes: true } });
  events.push(event.id);
  const path = `/events/${event.id}/queue`;
  const key = suffix => `queue:{${event.id}}:${suffix}`;
  const book = u => request(u, '/orders', 'POST', { ticketTypeId: event.ticketTypes[0].id, quantity: 1 });
  const required = async u => { const r = await book(u); assert.equal(r.status, 409); assert.equal(r.body.code, 'QUEUE_REQUIRED'); };
  await required(people[0]);
  const joined = await Promise.all(people.map(u => request(u, path, 'POST')));
  assert(joined.every(r => r.status === 200));
  const active = people.filter((_, i) => joined[i].body.state === 'ACTIVE');
  const waiting = people.filter((_, i) => joined[i].body.state === 'WAITING')
    .sort((a, b) => joined[people.indexOf(a)].body.position - joined[people.indexOf(b)].body.position);
  assert.equal(active.length, 2);
  assert.deepEqual(waiting.map(u => joined[people.indexOf(u)].body.position), [1, 2, 3, 4]);
  const repeated = await request(waiting[2], path, 'POST');
  assert.equal(repeated.body.position, 3);
  const polling = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const u = people[i % 6]; return { id: u.id, ...await request(u, `${path}/me`) };
  }));
  assert(polling.every(r => r.status === 200));
  assert(new Set(polling.filter(r => r.body.state === 'ACTIVE').map(r => r.id)).size <= 2);
  assert.equal(await redis.zcard(key('active')), 2);
  assert.equal((await book(active[0])).status, 201);
  assert.equal(await redis.zscore(key('active'), active[0].id), null);
  assert.equal((await request(waiting[0], `${path}/me`)).body.state, 'ACTIVE');
  const clock = await redis.time();
  const now = Number(clock[0]) * 1000 + Math.floor(Number(clock[1]) / 1000);
  await redis.zadd(key('active'), now - 1000, active[1].id);
  await required(active[1]);
  assert.equal((await request(active[1], `${path}/me`)).body.state, 'NONE');
  assert.equal((await request(waiting[1], `${path}/me`)).body.state, 'ACTIVE');
  // Người đầu hàng mất liên lạc: khi có chỗ trống phải bỏ qua, không hồi sinh khi điểm danh lại.
  await redis.hset(key('seen'), waiting[2].id, now - 60000);
  assert.equal((await request(waiting[0], path, 'DELETE')).body.state, 'NONE');
  assert.equal((await request(waiting[3], `${path}/me`)).body.state, 'ACTIVE');
  assert.equal((await request(waiting[2], `${path}/me`)).body.state, 'NONE');
  assert.equal((await request(active[0], path, 'POST')).body.state, 'WAITING');
  assert.equal((await request(active[0], path, 'DELETE')).body.state, 'NONE');
  assert.equal(await redis.zscore(key('waiting'), active[0].id), null);
  assert.equal((await request(people[0], `/events/${randomUUID()}/queue/me`)).status, 404);
  assert.equal((await request(null, `${path}/me`)).status, 401);

  const created = await request(organizer, '/events', 'POST', payload);
  assert.equal(created.status, 201);
  const apiEvent = created.body.event;
  // Lưu id trước assertion tiếp theo để vẫn dọn dữ liệu nếu kiểm tra thất bại.
  if (apiEvent?.id) events.push(apiEvent.id);
  assert.equal(apiEvent.queueEnabled, true);
  assert.equal(apiEvent.queueActiveLimit, 2);
  const updated = await request(organizer, `/events/${apiEvent.id}`, 'PUT', { ...payload, ticketTypes: undefined, queueEnabled: false, queueActiveLimit: 3 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.event.queueEnabled, false);
  assert.equal(updated.body.event.queueActiveLimit, 3);
  const invalid = await request(organizer, '/events', 'POST', { ...payload, queueActiveLimit: 0 });
  assert.equal(invalid.status, 400);
  assert.equal((await request(organizer, `/events/${apiEvent.id}`, 'PUT', { ...payload, queueActiveLimit: 0 })).status, 400);
  const disabledPath = `/events/${apiEvent.id}/queue`;
  assert.equal((await request(people[0], disabledPath, 'POST')).status, 409);
  assert.deepEqual((await request(people[0], `${disabledPath}/me`)).body, { state: 'NONE', queueEnabled: false });
  assert.equal((await request(people[0], '/orders', 'POST', { ticketTypeId: apiEvent.ticketTypes[0].id, quantity: 1 })).status, 201);
  console.log('✅ Phòng chờ: tất cả kiểm tra thành công');
}
async function cleanup() {
  // Dọn từng nhóm độc lập để một lỗi không bỏ qua phần còn lại.
  const actions = [
    () => prisma.order.deleteMany({ where: { userId: { in: users } } }),
    ...events.map(id => () => prisma.event.delete({ where: { id } })),
    () => prisma.user.deleteMany({ where: { id: { in: users } } }),
    ...events.map(id => async () => {
      // SCAN đúng namespace sự kiện, không dùng KEYS trên Redis dùng chung.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `queue:{${id}}:*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    }),
  ];
  for (const action of actions) try { await action(); } catch (e) { console.error(e); process.exitCode = 1; }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await cleanup(); await prisma.$disconnect(); redis.disconnect();
});
