/**
 * Bảng điều khiển bán vé của nhà tổ chức: doanh thu theo ngày (giờ Việt Nam), tổng,
 * loại vé bán chạy, tỉ lệ vào cổng, lọc theo sự kiện, quyền xem.
 * Dữ liệu đơn tạo thẳng bằng Prisma để đặt được ngày đặt đơn trong quá khứ.
 * Yêu cầu: server đang chạy, cùng DATABASE_URL (database test). Dùng: npm run test:dashboard.
 */
require('dotenv').config();
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';
const stamp = Date.now();
const password = 'MatKhauDaiHon8KyTu';
const DAY = 86_400_000;
const VN = 7 * 3_600_000;
const users = [];
const eventIds = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? `${G}✅` : `${R}❌`}${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
}

async function request(token, url) {
  const res = await fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function createUser(tag, role) {
  const email = `dashboard-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: `Dashboard ${tag}`, role },
    select: { id: true },
  });
  users.push(user.id);
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (res.status !== 200 || !body.token) throw new Error(`Không đăng nhập được (${res.status})`);
  return { id: user.id, token: body.token };
}

async function createEvent(organizerId, title, types) {
  const event = await prisma.event.create({
    data: {
      slug: `su-kien-${randomUUID()}`, title, location: 'HN',
      startTime: new Date(Date.now() + DAY * 5), endTime: new Date(Date.now() + DAY * 6), organizerId,
      ticketTypes: { create: types.map(([name, price, total]) => ({ name, price, totalQuantity: total, availableQuantity: total })) },
    },
    include: { ticketTypes: true },
  });
  eventIds.push(event.id);
  return { id: event.id, types: Object.fromEntries(event.ticketTypes.map((t) => [t.name, t.id])) };
}

/** Tạo đơn với tổng tiền, trạng thái, ngày đặt và số vé đã vào cổng cho trước. */
async function createOrder(userId, ticketTypeId, { qty, subtotal, discount = 0, status = 'CONFIRMED', createdAt, checkedIn = 0 }) {
  return prisma.order.create({
    data: {
      userId, status, createdAt,
      subtotalAmount: subtotal, discountAmount: discount, totalAmount: subtotal - discount,
      tickets: {
        create: Array.from({ length: qty }, (_, i) => ({
          ticketTypeId,
          qrCode: status === 'CONFIRMED' ? randomUUID() : null,
          checkedInAt: i < checkedIn ? new Date() : null,
        })),
      },
    },
  });
}

const dashboard = (user, query = '') => request(user.token, `/organizer/dashboard${query}`);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

async function main() {
  console.log(`\n${D}Bảng điều khiển bán vé${X}`);
  const organizer = await createUser('organizer', 'ORGANIZER');
  const other = await createUser('other', 'ORGANIZER');
  const empty = await createUser('empty', 'ORGANIZER');
  const buyer = await createUser('buyer', 'CUSTOMER');

  const eventA = await createEvent(organizer.id, 'DASH A', [['A1', 100000, 50], ['A2', 250000, 20]]);
  const eventB = await createEvent(organizer.id, 'DASH B', [['B1', 50000, 100]]);
  const eventC = await createEvent(other.id, 'DASH C', [['C1', 999000, 10]]);

  // Mốc 0h hôm nay theo giờ Việt Nam (tính bằng UTC).
  const now = Date.now();
  const todayVn = new Date(now + VN).toISOString().slice(0, 10);
  const vnMidnight = Date.parse(`${todayVn}T00:00:00Z`) - VN;
  const dayVn = (offset) => new Date(vnMidnight + VN - offset * DAY).toISOString().slice(0, 10);
  const at = (offset, minutes = 600) => new Date(vnMidnight - offset * DAY + minutes * 60_000);

  await createOrder(buyer.id, eventA.types.A1, { qty: 2, subtotal: 200000, createdAt: at(0), checkedIn: 1 });
  await createOrder(buyer.id, eventA.types.A2, { qty: 1, subtotal: 250000, discount: 50000, createdAt: at(2) });
  await createOrder(buyer.id, eventB.types.B1, { qty: 3, subtotal: 150000, createdAt: at(10), checkedIn: 3 });
  await createOrder(buyer.id, eventB.types.B1, { qty: 1, subtotal: 50000, createdAt: at(40) });
  // Ranh giới ngày: 0h05 hôm nay (giờ VN) vẫn là UTC hôm trước; 23h55 hôm qua.
  await createOrder(buyer.id, eventA.types.A1, { qty: 1, subtotal: 100000, createdAt: at(0, 5) });
  await createOrder(buyer.id, eventA.types.A1, { qty: 1, subtotal: 100000, createdAt: at(0, -5) });
  // Không được tính: đang giữ chỗ, đã huỷ, hết hạn, sự kiện của người khác.
  await createOrder(buyer.id, eventA.types.A1, { qty: 1, subtotal: 100000, status: 'PENDING', createdAt: at(0) });
  await createOrder(buyer.id, eventA.types.A1, { qty: 1, subtotal: 100000, status: 'CANCELLED', createdAt: at(0) });
  await createOrder(buyer.id, eventA.types.A2, { qty: 2, subtotal: 500000, status: 'EXPIRED', createdAt: at(1) });
  await createOrder(buyer.id, eventC.types.C1, { qty: 1, subtotal: 999000, createdAt: at(0), checkedIn: 1 });

  console.log(`\n${D}1. Tổng hợp mọi sự kiện, 30 ngày${X}`);
  const all = await dashboard(organizer);
  const data = all.body?.data;
  check('GET /organizer/dashboard -> 200', all.status === 200 && !!data, `nhận ${all.status} ${JSON.stringify(all.body)?.slice(0, 200)}`);
  check('chỉ liệt kê sự kiện của mình', data?.events?.length === 2 && data.events.every((e) => [eventA.id, eventB.id].includes(e.id)));
  const s = data?.summary ?? {};
  check('doanh thu chỉ tính đơn CONFIRMED, sau giảm giá', s.revenue === 800000, `nhận ${s.revenue}`);
  check('số đơn, số vé, tiền giảm', s.orders === 6 && s.ticketsSold === 9 && s.discount === 50000, JSON.stringify(s));
  check('sức chứa và số vé đã vào cổng', s.capacity === 170 && s.checkedIn === 4, JSON.stringify(s));
  check('khoảng mặc định 30 ngày, kết thúc hôm nay', data?.range?.days === 30 && data.daily?.length === 30 &&
    data.range.to === todayVn && data.daily[29].date === todayVn && data.range.from === dayVn(29));
  const byDate = Object.fromEntries((data?.daily ?? []).map((d) => [d.date, d]));
  check('hôm nay: gồm đơn 0h05, không gồm đơn 23h55 hôm qua', byDate[todayVn]?.revenue === 300000 &&
    byDate[todayVn].orders === 2 && byDate[todayVn].tickets === 3, JSON.stringify(byDate[todayVn]));
  check('hôm qua: đơn 23h55', byDate[dayVn(1)]?.revenue === 100000 && byDate[dayVn(1)].orders === 1, JSON.stringify(byDate[dayVn(1)]));
  check('2 ngày trước và 10 ngày trước', byDate[dayVn(2)]?.revenue === 200000 && byDate[dayVn(10)]?.revenue === 150000);
  check('ngày không bán được vẫn có, bằng 0', byDate[dayVn(5)]?.revenue === 0 && byDate[dayVn(5)].orders === 0);
  check('tổng 30 ngày không gồm đơn 40 ngày trước', sum(data?.daily ?? [], 'revenue') === 750000, `nhận ${sum(data?.daily ?? [], 'revenue')}`);

  console.log(`\n${D}2. Loại vé bán chạy và tỉ lệ vào cổng${X}`);
  const types = data?.ticketTypes ?? [];
  check('3 loại vé, không có loại của người khác', types.length === 3 && !types.some((t) => t.id === eventC.types.C1));
  check('sắp theo số vé bán, rồi doanh thu', types.map((t) => t.name).join(',') === 'A1,B1,A2', types.map((t) => `${t.name}:${t.sold}`).join(','));
  const a1 = types.find((t) => t.name === 'A1');
  const a2 = types.find((t) => t.name === 'A2');
  const b1 = types.find((t) => t.name === 'B1');
  check('A1: 4 vé, 400.000đ, 1 vào cổng, kèm tên sự kiện', a1?.sold === 4 && a1.revenue === 400000 && a1.checkedIn === 1 &&
    a1.eventTitle === 'DASH A' && a1.total === 50 && a1.price === 100000, JSON.stringify(a1));
  check('A2: doanh thu sau giảm giá', a2?.sold === 1 && a2.revenue === 200000, JSON.stringify(a2));
  check('B1: 4 vé, 200.000đ, 3 vào cổng', b1?.sold === 4 && b1.revenue === 200000 && b1.checkedIn === 3, JSON.stringify(b1));
  check('tổng doanh thu theo loại vé khớp tổng', sum(types, 'revenue') === s.revenue);
  const checkIn = Object.fromEntries((data?.eventsCheckIn ?? []).map((e) => [e.id, e]));
  check('vào cổng theo sự kiện', checkIn[eventA.id]?.sold === 5 && checkIn[eventA.id].checkedIn === 1 &&
    checkIn[eventB.id]?.sold === 4 && checkIn[eventB.id].checkedIn === 3, JSON.stringify(data?.eventsCheckIn));

  console.log(`\n${D}3. Khoảng ngày${X}`);
  const d90 = (await dashboard(organizer, '?days=90')).body?.data;
  check('90 ngày: gồm cả đơn 40 ngày trước', d90?.daily?.length === 90 && sum(d90.daily, 'revenue') === 800000);
  const d7 = (await dashboard(organizer, '?days=7')).body?.data;
  check('7 ngày: không gồm đơn 10 ngày trước', d7?.daily?.length === 7 && sum(d7.daily, 'revenue') === 600000, `nhận ${d7 && sum(d7.daily, 'revenue')}`);
  check('7 ngày: tổng toàn thời gian không đổi', d7?.summary?.revenue === 800000);
  const bad = (await dashboard(organizer, '?days=13')).body?.data;
  check('days không hợp lệ -> mặc định 30', bad?.range?.days === 30 && bad.daily.length === 30);

  console.log(`\n${D}4. Lọc theo sự kiện${X}`);
  const onlyB = await dashboard(organizer, `?eventId=${eventB.id}`);
  const b = onlyB.body?.data;
  check('lọc sự kiện B -> 200', onlyB.status === 200 && b?.eventId === eventB.id);
  check('B: doanh thu, đơn, vé, sức chứa', b?.summary?.revenue === 200000 && b.summary.orders === 2 &&
    b.summary.ticketsSold === 4 && b.summary.capacity === 100 && b.summary.checkedIn === 3, JSON.stringify(b?.summary));
  check('B: chỉ loại vé B1, vẫn trả danh sách mọi sự kiện cho bộ chọn', b?.ticketTypes?.length === 1 && b.ticketTypes[0].name === 'B1' && b.events.length === 2);
  check('B: 30 ngày chỉ có đơn 10 ngày trước', b && sum(b.daily, 'revenue') === 150000);
  const notMine = await dashboard(organizer, `?eventId=${eventC.id}`);
  const missing = await dashboard(organizer, `?eventId=${randomUUID()}`);
  check('sự kiện của người khác -> 404, giống sự kiện không tồn tại', notMine.status === 404 && missing.status === 404 &&
    notMine.body?.message === missing.body?.message);

  console.log(`\n${D}5. Quyền xem${X}`);
  check('khách thường -> 403', (await dashboard(buyer)).status === 403);
  check('chưa đăng nhập -> 401', (await request('', '/organizer/dashboard')).status === 401);
  const otherData = (await dashboard(other)).body?.data;
  check('nhà tổ chức khác chỉ thấy số liệu của mình', otherData?.summary?.revenue === 999000 && otherData.summary.ticketsSold === 1 &&
    otherData.events.length === 1 && otherData.events[0].id === eventC.id);
  const emptyData = await dashboard(empty);
  check('chưa có sự kiện: số 0, vẫn đủ 30 ngày', emptyData.status === 200 && emptyData.body?.data?.summary?.revenue === 0 &&
    emptyData.body.data.summary.capacity === 0 && emptyData.body.data.daily.length === 30 &&
    emptyData.body.data.ticketTypes.length === 0 && emptyData.body.data.eventsCheckIn.length === 0);
}

async function cleanup() {
  const remove = async (action) => {
    try { await action(); } catch (error) {
      check('dọn dữ liệu kiểm thử', false, error.message);
    }
  };
  await remove(() => prisma.order.deleteMany({ where: { userId: { in: users } } }));
  for (const id of eventIds) await remove(() => prisma.event.deleteMany({ where: { id } }));
  await remove(() => prisma.user.deleteMany({ where: { id: { in: users } } }));
}

main().catch((error) => {
  check('chạy bộ test không gặp lỗi ngoài dự kiến', false, error.message);
  console.error(error);
}).finally(async () => {
  await cleanup();
  await prisma.$disconnect();
  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
});
