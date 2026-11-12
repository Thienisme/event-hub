/** Cần server, MySQL tạm và Redis; không chạy trên database thật. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const assert = require('node:assert/strict');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const prefix = `FILTERS-${Date.now()}-${process.pid}`;
const categories = ['MUSIC', 'SPORTS', 'CONFERENCE', 'WORKSHOP', 'THEATER', 'EXHIBITION', 'FESTIVAL', 'FOOD', 'OTHER'];
const year = new Date().getUTCFullYear() + 2;
const day = `${year}-06-15`;
const startTime = `${day}T12:00:00+07:00`;
const endTime = `${year}-06-17T00:00:00+07:00`;
let user;
let passed = 0;
async function request(url, method = 'GET', body, token) {
  const res = await fetch(`${API}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function expect(filters, names) {
  const res = await request(`/events?${new URLSearchParams({ search: prefix, limit: '50', ...filters })}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map(e => e.title.slice(prefix.length + 1)).sort(), [...names].sort());
  assert.equal(res.body.pagination.total, names.length);
  console.log(`  ✅ ${JSON.stringify(filters)}`);
  passed++;
  return res.body;
}
async function main() {
  const password = 'MatKhauDaiHon8KyTu';
  user = await prisma.user.create({ data: {
    email: `${prefix}@test.local`, fullName: 'Bộ lọc', role: 'ORGANIZER', password: await bcrypt.hash(password, 4),
  } });
  for (const [i, category] of categories.entries()) {
    await prisma.event.create({ data: {
      title: `${prefix}-${category}`, category, organizerId: user.id,
      location: i % 2 === 0 ? 'Nhà hát Hà Nội' : 'Sân vận động Đà Nẵng',
      startTime: new Date(i === 0 ? `${day}T23:59:59.999+07:00` : i === 1 ? `${year}-06-16T00:00:00+07:00` : startTime),
      endTime: new Date(endTime),
      ticketTypes: { create: (i === 0 ? [0, 1000] : [i * 100]).map(price => ({ name: `Vé ${price}`, price, totalQuantity: 10, availableQuantity: 10 })) },
    } });
  }
  for (const category of categories) await expect({ category }, [category]);
  await expect({ location: '  Hà Nội  ' }, categories.filter((_, i) => i % 2 === 0));
  await expect({ from: `${year}-06-16` }, ['SPORTS']);
  const sameDay = categories.filter(c => c !== 'SPORTS');
  await expect({ to: day }, sameDay);
  await expect({ from: day, to: day, category: 'MUSIC', location: 'Hà Nội', minPrice: '900', maxPrice: '1000' }, ['MUSIC']);
  await expect({ minPrice: '200', maxPrice: '400' }, ['CONFERENCE', 'WORKSHOP', 'THEATER']);
  await expect({ minPrice: '400', maxPrice: '200' }, ['CONFERENCE', 'WORKSHOP', 'THEATER']);
  await expect({ minPrice: '0', maxPrice: '0' }, ['MUSIC']);
  await expect({ minPrice: '400' }, ['MUSIC', ...categories.slice(4)]);
  await expect({ maxPrice: '100' }, ['MUSIC', 'SPORTS']);
  // Hai loại vé hai phía khoảng giá không được coi là vé nằm trong khoảng.
  await expect({ category: 'MUSIC', minPrice: '100', maxPrice: '900' }, []);
  await expect({ category: 'SAI', location: '', from: '2027-02-30', to: 'sai', minPrice: '-1', maxPrice: 'NaN' }, categories);
  await expect({ 'category[]': 'MUSIC', 'location[x]': 'HN', 'from[]': day, 'minPrice[]': '100' }, categories);
  await expect({ from: `${year}-06-20`, to: day }, categories);
  await expect({ minPrice: '999999999999', maxPrice: '999999999999' }, []);
  assert.equal((await expect({ category: 'FOOD' }, ['FOOD'])).source, 'cache');
  await expect({ category: 'THEATER' }, ['THEATER']);
  await expect({ minPrice: '200', maxPrice: '400', location: 'Hà Nội' }, ['CONFERENCE', 'THEATER']);
  assert.equal((await expect({ minPrice: '0400.00', maxPrice: '0200', location: '  Hà Nội  ' }, ['CONFERENCE', 'THEATER'])).source, 'cache');
  await expect({ from: day, to: day }, sameDay);
  assert.equal((await expect({ from: `${year}-06-14T17:00:00.000Z`, to: `${day}T16:59:59.999Z` }, sameDay)).source, 'cache');
  const login = await request('/auth/login', 'POST', { email: user.email, password });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const payload = { title: `${prefix}-API`, location: 'Hà Nội', startTime, endTime, category: 'WORKSHOP' };
  const created = await request('/events', 'POST', payload, token);
  assert.equal(created.status, 201);
  assert.equal(created.body.event.category, 'WORKSHOP');
  await expect({ category: 'WORKSHOP' }, ['WORKSHOP', 'API']);
  const id = created.body.event.id;
  const updated = await request(`/events/${id}`, 'PUT', { ...payload, category: 'MUSIC' }, token);
  assert.equal(updated.status, 200);
  assert.equal((await prisma.event.findUnique({ where: { id } })).category, 'MUSIC');
  await expect({ category: 'WORKSHOP' }, ['WORKSHOP']);
  await expect({ category: 'MUSIC' }, ['MUSIC', 'API']);
  const { category, ...withoutCategory } = payload;
  assert.equal((await request(`/events/${id}`, 'PUT', withoutCategory, token)).status, 200);
  assert.equal((await prisma.event.findUnique({ where: { id } })).category, 'MUSIC');
  const defaultCategory = await request('/events', 'POST', { ...withoutCategory, title: `${prefix}-DEFAULT` }, token);
  assert.equal(defaultCategory.status, 201);
  assert.equal(defaultCategory.body.event.category, 'OTHER');
  console.log(`\n✅ ${passed} kiểm tra bộ lọc và tạo/sửa category thành công.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    if (user) {
      await prisma.event.deleteMany({ where: { organizerId: user.id, title: { startsWith: prefix } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  } finally { await prisma.$disconnect(); }
});
