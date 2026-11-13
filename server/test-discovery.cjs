/** Chỉ chạy với MySQL tạm; cùng DATABASE_URL và Redis với server, không nạp .env. */
const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(database.hostname) || !/(test|tmp|temp)/i.test(database.pathname)) {
  throw new Error('Test discovery yêu cầu DATABASE_URL cục bộ có tên database chứa test/tmp/temp.');
}
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, EventCategory } = require('@prisma/client');
const Redis = require('ioredis');
const prisma = new PrismaClient();
const options = { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
  connectTimeout: 1000, commandTimeout: 1000, retryStrategy: () => null };
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, options)
  : new Redis({ ...options, host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT) || 6379 });
redis.on('error', () => {});
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const stamp = randomUUID();
const ids = [];
let owner;
// Ghi qua Prisma không đi qua controller: tăng version như invalidateEventList.
async function invalidate() { if (redis.status === 'ready') await redis.incr('events:list:v'); }
async function get(path) {
  const response = await fetch(`${API}/events/${path}`);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data;
}
async function main() {
  await redis.connect().catch(() => {});
  await invalidate();
  const before = await get('categories');
  const categories = Object.values(EventCategory);
  assert.equal(categories.length, 9);
  assert.deepEqual(before.map(item => item.category), categories);
  owner = await prisma.user.create({ data: { email: `discovery-${stamp}@test.local`,
    password: 'khong-dung-dang-nhap', fullName: 'Thử discovery', role: 'ORGANIZER' } });
  const now = Date.now(), day = 86400000;
  async function create(tag, category, start, end, availableQuantity = 10) {
    const event = await prisma.event.create({ data: {
      slug: `discovery-${tag}-${stamp}`, title: `Thử discovery ${tag}`, category,
      location: 'Hà Nội', bannerUrl: '/uploads/discovery.webp', organizerId: owner.id,
      startTime: new Date(now + start), endTime: new Date(now + end),
      ticketTypes: { create: { name: 'Vé thử', price: 100000, totalQuantity: 10, availableQuantity } },
    } });
    ids.push(event.id);
    return event;
  }
  const week = await create('week', 'MUSIC', day, 2 * day);
  const scarce = await create('scarce', 'EXHIBITION', 30 * day, 31 * day, 1);
  const ended = await create('ended', 'MUSIC', -2 * day, -day);
  await invalidate();
  const after = await get('categories');
  assert.deepEqual(after.map(item => item.category), categories);
  for (const item of after) {
    assert.ok(Number.isInteger(item.count) && item.count >= 0);
    const increment = ['MUSIC', 'EXHIBITION'].includes(item.category) ? 1 : 0;
    assert.equal(item.count, before.find(old => old.category === item.category).count + increment, item.category);
  }
  const highlights = await get('highlights');
  assert.deepEqual(Object.keys(highlights).sort(), ['almostSoldOut', 'newlyOnSale', 'thisWeek']);
  assert.ok(highlights.thisWeek.some(event => event.id === week.id));
  assert.ok(highlights.almostSoldOut.some(event => event.id === scarce.id));
  const scarceIds = new Set(highlights.almostSoldOut.map(event => event.id));
  assert.ok(highlights.newlyOnSale.every(event => !scarceIds.has(event.id)));
  // Không sự kiện nào xuất hiện ở hai hàng.
  const allIds = [...highlights.thisWeek, ...highlights.almostSoldOut, ...highlights.newlyOnSale].map(event => event.id);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const events of Object.values(highlights)) {
    assert.ok(events.length <= 8);
    assert.ok(!events.some(event => event.id === ended.id));
    assert.equal(new Set(events.map(event => event.id)).size, events.length);
    for (const event of events) {
      assert.ok(Array.isArray(event.ticketTypes));
      for (const field of ['bannerUrl', 'category', 'slug']) assert.ok(field in event);
      assert.deepEqual(Object.keys(event.organizer).sort(), ['fullName', 'id']);
    }
  }
  for (let i = 1; i < highlights.thisWeek.length; i++) {
    assert.ok(new Date(highlights.thisWeek[i - 1].startTime) <= new Date(highlights.thisWeek[i].startTime));
  }
  assert.deepEqual(await get('categories'), after);
  assert.deepEqual(await get('highlights'), highlights);
  console.log('✅ Discovery: danh mục, tuần này, gần hết vé, không lặp và cache');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
    if (owner) await prisma.user.delete({ where: { id: owner.id } });
    await invalidate();
  } catch (error) {
    console.error('Dọn dữ liệu discovery thất bại:', error);
    process.exitCode = 1;
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
});
