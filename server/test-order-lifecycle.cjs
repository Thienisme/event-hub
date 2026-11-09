/**
 * Vòng đời đơn hàng: xác nhận, huỷ, sinh QR, hạn mức theo tài khoản, và tranh chấp
 * giữa các thao tác. Yêu cầu: server đang chạy, cùng DATABASE_URL với script này.
 * Dùng: npm run test:lifecycle
 */
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? `${G}✅` : `${R}❌`}${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
}

const stamp = Date.now();
const password = 'MatKhauDaiHon8KyTu';
const DAY = 86_400_000;
const users = [];
const eventIds = [];

async function createUser(tag) {
  const email = `lifecycle-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: 'Lifecycle', role: 'ORGANIZER' },
    select: { id: true },
  });
  users.push(user.id);
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await res.json();
  if (!token) throw new Error(`Không đăng nhập được (${res.status})`);
  return { id: user.id, token };
}

async function createEvent(organizerId, totalQuantity = 500) {
  const event = await prisma.event.create({
    data: {
      title: 'LIFECYCLE',
      location: 'HN',
      startTime: new Date(Date.now() + DAY),
      endTime: new Date(Date.now() + DAY * 2),
      organizerId,
      ticketTypes: {
        create: [{ name: 'A', price: 1000, totalQuantity, availableQuantity: totalQuantity }],
      },
    },
    include: { ticketTypes: true },
  });
  eventIds.push(event.id);
  return { id: event.id, ticketTypeId: event.ticketTypes[0].id };
}

const post = async (token, url, body, base = API) => {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const book = (user, ticketTypeId, quantity) => post(user.token, '/orders', { ticketTypeId, quantity });
const stock = async (id) =>
  (await prisma.ticketType.findUnique({ where: { id } })).availableQuantity;

async function testConfirm(owner, stranger, organizer) {
  console.log(`\n${D}1. Xác nhận thanh toán và sinh QR${X}`);
  const event = await createEvent(organizer.id);
  const { body } = await book(owner, event.ticketTypeId, 3);
  const id = body.order.id;

  check('đơn mới chưa có QR', body.order.tickets.every((t) => !t.qrCode));
  const foreign = await post(stranger.token, `/orders/${id}/confirm`);
  check('người khác xác nhận -> 404', foreign.status === 404, `nhận ${foreign.status}`);

  const first = await post(owner.token, `/orders/${id}/confirm`);
  const codes = first.body.order?.tickets.map((t) => t.qrCode) ?? [];
  check('xác nhận -> 200 CONFIRMED', first.status === 200 && first.body.order?.status === 'CONFIRMED');
  check('mỗi vé có QR riêng', codes.length === 3 && new Set(codes).size === 3 && codes.every(Boolean));

  const again = await post(owner.token, `/orders/${id}/confirm`);
  const same = again.body.order?.tickets.map((t) => t.qrCode).sort().join() === [...codes].sort().join();
  check('xác nhận lại -> 200, giữ nguyên QR', again.status === 200 && same);

  const cancel = await post(owner.token, `/orders/${id}/cancel`);
  check('huỷ đơn đã thanh toán -> 409', cancel.status === 409, `nhận ${cancel.status}`);
  check('kho vẫn bị trừ', (await stock(event.ticketTypeId)) === 497);

  const stats = await (
    await fetch(`${API}/organizer/stats`, { headers: { Authorization: `Bearer ${organizer.token}` } })
  ).json();
  check('doanh thu của nhà tổ chức được tính', Number(stats.data?.revenue) === 3000, `revenue = ${stats.data?.revenue}`);

  const del = await fetch(`${API}/events/${event.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${organizer.token}` },
  });
  check('xoá sự kiện có đơn CONFIRMED -> 400', del.status === 400, `nhận ${del.status}`);

  const held = await book(owner, event.ticketTypeId, 1);
  await prisma.order.update({
    where: { id: held.body.order.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const late = await post(owner.token, `/orders/${held.body.order.id}/confirm`);
  check('xác nhận đơn quá hạn -> 409', late.status === 409, `nhận ${late.status}`);
}

async function testCancel(owner, stranger, organizer) {
  console.log(`\n${D}2. Huỷ đơn${X}`);
  const event = await createEvent(organizer.id);
  const { body } = await book(owner, event.ticketTypeId, 5);
  const id = body.order.id;

  const foreign = await post(stranger.token, `/orders/${id}/cancel`);
  check('người khác huỷ -> 404', foreign.status === 404, `nhận ${foreign.status}`);

  const cancel = await post(owner.token, `/orders/${id}/cancel`);
  check('huỷ -> 200 CANCELLED', cancel.status === 200 && cancel.body.order?.status === 'CANCELLED');
  check('vé được trả về kho', (await stock(event.ticketTypeId)) === 500);

  const again = await post(owner.token, `/orders/${id}/cancel`);
  check('huỷ lại -> 200, không cộng vé lần nữa', again.status === 200 && (await stock(event.ticketTypeId)) === 500);

  const pay = await post(owner.token, `/orders/${id}/confirm`);
  check('thanh toán đơn đã huỷ -> 409', pay.status === 409, `nhận ${pay.status}`);

  const del = await fetch(`${API}/events/${event.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${organizer.token}` },
  });
  check('xoá sự kiện chỉ có đơn đã huỷ -> 200', del.status === 200, `nhận ${del.status}`);
}

async function testRaces(owner, organizer) {
  console.log(`\n${D}3. Tranh chấp giữa các thao tác${X}`);
  const event = await createEvent(organizer.id);

  let invalid = 0;
  for (let i = 0; i < 6; i += 1) {
    const { body } = await book(owner, event.ticketTypeId, 2);
    const before = await stock(event.ticketTypeId);
    const [pay, cancel] = await Promise.all([
      post(owner.token, `/orders/${body.order.id}/confirm`),
      post(owner.token, `/orders/${body.order.id}/cancel`),
    ]);
    const row = await prisma.order.findUnique({ where: { id: body.order.id } });
    const after = await stock(event.ticketTypeId);
    const okConfirmed = row.status === 'CONFIRMED' && pay.status === 200 && cancel.status === 409 && after === before;
    const okCancelled = row.status === 'CANCELLED' && cancel.status === 200 && pay.status === 409 && after === before + 2;
    if (!okConfirmed && !okCancelled) {
      invalid += 1;
      console.log(`    ${row.status} pay=${pay.status} cancel=${cancel.status} kho ${before}->${after}`);
    }
  }
  check('xác nhận và huỷ cùng lúc: đúng một bên thắng, kho khớp (6 lần)', invalid === 0);

  const { body } = await book(owner, event.ticketTypeId, 2);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => post(owner.token, `/orders/${body.order.id}/cancel`))
  );
  const before = 500 - (await prisma.ticket.count({
    where: { ticketTypeId: event.ticketTypeId, order: { status: { in: ['PENDING', 'CONFIRMED'] } } },
  }));
  check(
    'huỷ đồng thời 5 lần chỉ trả vé một lần',
    results.every((r) => r.status === 200) && (await stock(event.ticketTypeId)) === before,
    `kho ${await stock(event.ticketTypeId)}, kỳ vọng ${before}`
  );
}

async function testPerUserLimit(organizer) {
  console.log(`\n${D}4. Hạn mức vé theo tài khoản${X}`);
  const sequential = await createUser('limit-a');
  const event = await createEvent(organizer.id);

  check('giữ 60 vé -> 201', (await book(sequential, event.ticketTypeId, 60)).status === 201);
  const second = await book(sequential, event.ticketTypeId, 40);
  check('thêm 40 vé, vừa đúng 100 -> 201', second.status === 201, `nhận ${second.status}`);
  const over = await book(sequential, event.ticketTypeId, 1);
  check('vượt hạn mức -> 400', over.status === 400, `${over.status} "${over.body?.message}"`);
  check('kho không bị trừ khi vượt hạn mức', (await stock(event.ticketTypeId)) === 400);

  await post(sequential.token, `/orders/${second.body.order.id}/cancel`);
  check('huỷ đơn thì có lại hạn mức', (await book(sequential, event.ticketTypeId, 10)).status === 201);

  const other = await createEvent(organizer.id);
  check('hạn mức tính riêng cho từng sự kiện', (await book(sequential, other.ticketTypeId, 50)).status === 201);

  const parallel = await createUser('limit-b');
  // Hai loại vé: Redlock khoá theo loại vé nên không xếp hàng được các đơn này.
  // Chỉ khoá dòng user mới giữ được hạn mức ở đây.
  const race = await createEvent(organizer.id);
  const secondType = await prisma.ticketType.create({
    data: { eventId: race.id, name: 'B', price: 1000, totalQuantity: 500, availableQuantity: 500 },
  });
  const types = [race.ticketTypeId, secondType.id];
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => book(parallel, types[i % 2], 30))
  );
  const ok = results.filter((r) => r.status === 201).length;
  const held = await prisma.ticket.count({
    where: { ticketTypeId: { in: types }, order: { userId: parallel.id } },
  });
  check('8 đơn đồng thời trên 2 loại vé không vượt hạn mức', ok === 3 && held === 90, `${ok} đơn, ${held} vé, status ${results.map((r) => r.status).join()}`);
  check('kho khớp số vé đã giữ', (await stock(race.ticketTypeId)) + (await stock(secondType.id)) === 910);
}

async function testProductionGuard(owner, organizer) {
  console.log(`\n${D}5. Thanh toán giả lập tắt ở production${X}`);
  const event = await createEvent(organizer.id);
  const { body } = await book(owner, event.ticketTypeId, 1);
  const port = 5900 + Math.floor(Math.random() * 90);
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'src/app.ts')],
    {
      cwd: __dirname,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production', ALLOW_SIMULATED_PAYMENT: '', ORDER_SWEEP_INTERVAL_MS: '3600000' },
      stdio: 'ignore',
    }
  );
  try {
    const base = `http://127.0.0.1:${port}/api`;
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
    }
    const res = await post(owner.token, `/orders/${body.order.id}/confirm`, undefined, base);
    check('NODE_ENV=production -> 404', up && res.status === 404, `nhận ${res.status}`);
    const row = await prisma.order.findUnique({ where: { id: body.order.id } });
    check('đơn vẫn PENDING', row.status === 'PENDING');
  } finally {
    child.kill();
  }
}

async function cleanup() {
  await prisma.order.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  for (const id of eventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
}

async function main() {
  console.log(`\n${D}Vòng đời đơn hàng${X}`);
  const owner = await createUser('owner');
  const stranger = await createUser('stranger');
  const organizer = await createUser('organizer');

  await testConfirm(owner, stranger, organizer);
  await testCancel(owner, stranger, organizer);
  await testRaces(owner, organizer);
  await testPerUserLimit(organizer);
  await testProductionGuard(owner, organizer);

  await cleanup();
  await prisma.$disconnect();
  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
