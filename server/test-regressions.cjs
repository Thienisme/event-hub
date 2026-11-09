/**
 * Test hồi quy cho các lỗi đã phát hiện khi review toàn dự án.
 *
 * Mỗi nhóm `check` tương ứng một lỗi đã từng xảy ra:
 *   1. Sự kiện chỉ có đơn EXPIRED bị kẹt, không xoá được (FK của tickets).
 *   2. Route async ném lỗi làm sập cả tiến trình server (/auth/me).
 *   3. Đặt được vé của sự kiện đã kết thúc.
 *   4. API công khai làm lộ email của nhà tổ chức.
 *   5. GET /events không giới hạn `limit`/`page`.
 *   6. `validateBody` bỏ kết quả parse: `.trim()` không có tác dụng.
 *   7. JSON sai định dạng trả về HTML thay vì JSON.
 *
 * Yêu cầu: server đang chạy, cùng DATABASE_URL/JWT_SECRET/REDIS_* với script này.
 * Dùng:    npm run test:regressions
 */
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

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
let organizer = null;
let customer = null;
const eventIds = [];

const DAY = 86_400_000;

async function createEvent({ startOffset = DAY, endOffset = DAY * 2, title = 'REGRESSION' } = {}) {
  const event = await prisma.event.create({
    data: {
      title,
      location: 'HN',
      startTime: new Date(Date.now() + startOffset),
      endTime: new Date(Date.now() + endOffset),
      organizerId: organizer.id,
      ticketTypes: {
        create: [{ name: 'STANDARD', price: 100000, totalQuantity: 10, availableQuantity: 10 }],
      },
    },
    include: { ticketTypes: true },
  });
  eventIds.push(event.id);
  return event;
}

const createOrderRow = (ticketTypeId, status) =>
  prisma.order.create({
    data: {
      userId: customer.id,
      totalAmount: 100000,
      status,
      expiresAt: new Date(Date.now() - 1000),
      tickets: { create: [{ ticketTypeId }] },
    },
  });

async function createUser(prefix, role) {
  const email = `${prefix}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: 'Regression', role },
    select: { id: true, email: true },
  });
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await res.json();
  if (!token) throw new Error(`Không đăng nhập được (${res.status})`);
  return { ...user, token };
}

const authed = (token, method, url, body) =>
  fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const eventPayload = (event, overrides = {}) => ({
  title: event.title,
  location: event.location,
  startTime: event.startTime.toISOString(),
  endTime: event.endTime.toISOString(),
  ...overrides,
});

async function testExpiredOrdersDoNotBlockDeletion() {
  console.log(`\n${D}1. Đơn hết hạn không được làm kẹt sự kiện${X}`);

  const expiredOnly = await createEvent();
  await createOrderRow(expiredOnly.ticketTypes[0].id, 'EXPIRED');
  const del = await authed(organizer.token, 'DELETE', `/events/${expiredOnly.id}`);
  check('xoá sự kiện chỉ có đơn EXPIRED -> 200', del.status === 200, `nhận ${del.status}`);

  const pending = await createEvent();
  await createOrderRow(pending.ticketTypes[0].id, 'PENDING');
  const delPending = await authed(organizer.token, 'DELETE', `/events/${pending.id}`);
  check('xoá sự kiện có đơn PENDING -> 400', delPending.status === 400, `nhận ${delPending.status}`);
  check(
    'sự kiện có đơn PENDING vẫn còn nguyên',
    (await prisma.event.count({ where: { id: pending.id } })) === 1
  );

  const confirmed = await createEvent();
  await createOrderRow(confirmed.ticketTypes[0].id, 'CONFIRMED');
  const delConfirmed = await authed(organizer.token, 'DELETE', `/events/${confirmed.id}`);
  check('xoá sự kiện có đơn CONFIRMED -> 400', delConfirmed.status === 400, `nhận ${delConfirmed.status}`);

  const removeType = await createEvent();
  await createOrderRow(removeType.ticketTypes[0].id, 'EXPIRED');
  const put = await authed(
    organizer.token,
    'PUT',
    `/events/${removeType.id}`,
    eventPayload(removeType, { ticketTypes: [] })
  );
  check('bỏ loại vé chỉ có đơn EXPIRED -> 200', put.status === 200, `nhận ${put.status}`);
  check(
    'loại vé đã bị xoá thật',
    (await prisma.ticketType.count({ where: { eventId: removeType.id } })) === 0
  );
}

/**
 * Dựng instance riêng trỏ tới database không tồn tại. Trạng thái tài khoản được
 * đặt sẵn trong Redis để qua được `authenticate` và đi tới đúng handler /auth/me.
 */
async function testRouteErrorDoesNotCrashServer() {
  console.log(`\n${D}2. Lỗi database trong route không được làm sập server${X}`);

  const port = 5900 + Math.floor(Math.random() * 90);
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
  });
  const userId = `crash-test-${stamp}`;
  await redis.set(
    `user:state:${userId}`,
    JSON.stringify({ role: 'CUSTOMER', isActive: true, email: 'crash@test.local' }),
    'EX',
    60
  );
  const token = jwt.sign({ userId, role: 'CUSTOMER' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1m',
  });

  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'src/app.ts')],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: 'mysql://root:x@127.0.0.1:1/none',
        ORDER_SWEEP_INTERVAL_MS: '3600000',
      },
      stdio: 'ignore',
    }
  );

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  try {
    const base = `http://127.0.0.1:${port}/api`;
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(`${base}/events/x-not-found-health`, { signal: AbortSignal.timeout(400) })
        .then(() => true)
        .catch((error) => error.name === 'TimeoutError');
    }
    check('instance thử nghiệm đã khởi động', up);

    const res = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    await new Promise((r) => setTimeout(r, 1000));
    check('tiến trình server vẫn sống sau lỗi database', !exited);
    check('client nhận 500 dạng JSON', res?.status === 500, `nhận ${res?.status ?? 'không có phản hồi'}`);
  } finally {
    child.kill();
    await redis.del(`user:state:${userId}`);
    redis.disconnect();
  }
}

async function testEndedEventCannotBeBooked() {
  console.log(`\n${D}3. Không đặt được vé của sự kiện đã kết thúc${X}`);

  const ended = await createEvent({ startOffset: -DAY * 2, endOffset: -DAY });
  const ticketTypeId = ended.ticketTypes[0].id;
  const res = await authed(customer.token, 'POST', '/orders', { ticketTypeId, quantity: 1 });
  const row = await prisma.ticketType.findUnique({ where: { id: ticketTypeId } });
  check('đặt vé sự kiện đã kết thúc -> 400', res.status === 400, `nhận ${res.status}`);
  check('kho vé không bị trừ', row.availableQuantity === 10, `còn ${row.availableQuantity}`);

  const ongoing = await createEvent({ startOffset: -DAY, endOffset: DAY });
  const ok = await authed(customer.token, 'POST', '/orders', {
    ticketTypeId: ongoing.ticketTypes[0].id,
    quantity: 1,
  });
  check('sự kiện đang diễn ra vẫn đặt được -> 201', ok.status === 201, `nhận ${ok.status}`);
}

async function testPublicApiHidesOrganizerEmail() {
  console.log(`\n${D}4. API công khai không lộ email nhà tổ chức${X}`);

  const event = await createEvent();
  const detail = await (await fetch(`${API}/events/${event.id}`)).json();
  check('chi tiết sự kiện không có organizer.email', detail.data?.organizer?.email === undefined);
  check('chi tiết sự kiện vẫn có tên nhà tổ chức', Boolean(detail.data?.organizer?.fullName));

  const list = await (await fetch(`${API}/events?limit=5`)).json();
  check(
    'danh sách sự kiện không có organizer.email',
    list.data?.length > 0 && list.data.every((item) => item.organizer?.email === undefined)
  );
}

async function testListPaginationIsBounded() {
  console.log(`\n${D}5. GET /events giới hạn tham số phân trang${X}`);

  const huge = await fetch(`${API}/events?limit=1000000`);
  const hugeBody = await huge.json().catch(() => ({}));
  check('limit quá lớn bị giới hạn ở 100', hugeBody.pagination?.limit === 100, `limit = ${hugeBody.pagination?.limit}`);

  for (const query of ['limit=-1', 'page=-1', 'page=0', 'limit=abc', 'page=1e30', 'page=99999999999999999999']) {
    const res = await fetch(`${API}/events?${query}`);
    check(`?${query} -> 200`, res.status === 200, `nhận ${res.status}`);
  }

  const longSearch = await fetch(`${API}/events?search=${'a'.repeat(5000)}`);
  check('search rất dài -> 200', longSearch.status === 200, `nhận ${longSearch.status}`);

  const hugePage = 'page=99999999999999999999';
  const myOrders = await authed(organizer.token, 'GET', `/orders/my-orders?${hugePage}`);
  check('/orders/my-orders page rất lớn -> 200', myOrders.status === 200, `nhận ${myOrders.status}`);

  const myEvents = await authed(organizer.token, 'GET', `/organizer/events?${hugePage}`);
  check('/organizer/events page rất lớn -> 200', myEvents.status === 200, `nhận ${myEvents.status}`);
}

async function testValidatedBodyIsUsed() {
  console.log(`\n${D}6. Controller dùng dữ liệu đã qua validate${X}`);

  const start = new Date(Date.now() + DAY).toISOString();
  const end = new Date(Date.now() + DAY * 2).toISOString();
  const res = await authed(organizer.token, 'POST', '/events', {
    title: '   Tiêu đề có khoảng trắng   ',
    location: '  Hà Nội  ',
    startTime: start,
    endTime: end,
    organizerId: 'gia-mao',
  });
  const body = await res.json();
  if (body.event?.id) eventIds.push(body.event.id);
  check('tạo sự kiện -> 201', res.status === 201, `nhận ${res.status}`);
  check('title đã được trim', body.event?.title === 'Tiêu đề có khoảng trắng', JSON.stringify(body.event?.title));
  check('location đã được trim', body.event?.location === 'Hà Nội', JSON.stringify(body.event?.location));
  check('organizerId vẫn lấy từ token', body.event?.organizerId === organizer.id);
}

async function testMalformedJson() {
  console.log(`\n${D}7. JSON sai định dạng trả về lỗi dạng JSON${X}`);

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": ',
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  check('trả về 400', res.status === 400, `nhận ${res.status}`);
  check('nội dung là JSON có message', typeof parsed?.message === 'string', text.slice(0, 60));
  check('không lộ stack trace', !/node_modules|at .*\.js/.test(text));
}

async function cleanup() {
  const userIds = [organizer?.id, customer?.id].filter(Boolean);
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  for (const id of eventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
}

async function main() {
  console.log(`\n${D}Test hồi quy${X}`);

  organizer = await createUser('regression-organizer', 'ORGANIZER');
  customer = await createUser('regression-customer', 'CUSTOMER');

  await testExpiredOrdersDoNotBlockDeletion();
  await testRouteErrorDoesNotCrashServer();
  await testEndedEventCannotBeBooked();
  await testPublicApiHidesOrganizerEmail();
  await testListPaginationIsBounded();
  await testValidatedBodyIsUsed();
  await testMalformedJson();

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
