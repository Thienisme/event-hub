/**
 * Soát vé QR: quyền truy cập, trạng thái vé, quét đồng thời và thống kê.
 * Yêu cầu: server đang chạy, cùng DATABASE_URL với script này (database test).
 * Dùng: npm run test:checkin. Tổng cộng 43 request API khi chạy thành công.
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
const users = [];
const eventIds = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? `${G}✅` : `${R}❌`}${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
}

async function request(token, url, method = 'GET', body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function createUser(tag, role) {
  const email = `checkin-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: 'Check-in', role },
    select: { id: true },
  });
  users.push(user.id);
  const res = await request('', '/auth/login', 'POST', { email, password });
  if (res.status !== 200 || !res.body?.token) throw new Error(`Không đăng nhập được (${res.status})`);
  return { id: user.id, token: res.body.token };
}

async function createEvent(organizerId) {
  const event = await prisma.event.create({
    data: {
      slug: `su-kien-${require('crypto').randomUUID()}`,
      title: 'CHECKIN',
      location: 'HN',
      startTime: new Date(Date.now() + DAY),
      endTime: new Date(Date.now() + DAY * 2),
      organizerId,
      ticketTypes: {
        create: [{ name: 'A', price: 1000, totalQuantity: 50, availableQuantity: 50 }],
      },
    },
    include: { ticketTypes: true },
  });
  eventIds.push(event.id);
  return { id: event.id, ticketTypeId: event.ticketTypes[0].id };
}

async function book(customer, event, quantity, confirm = true) {
  const booked = await request(customer.token, '/orders', 'POST', { ticketTypeId: event.ticketTypeId, quantity });
  if (booked.status !== 201 || !booked.body?.order?.id) {
    throw new Error(`Không đặt được vé (${booked.status}): ${JSON.stringify(booked.body)}`);
  }
  if (!confirm) return booked.body.order;
  const paid = await request(customer.token, `/orders/${booked.body.order.id}/confirm`, 'POST');
  if (paid.status !== 200 || paid.body?.order?.status !== 'CONFIRMED' ||
      paid.body.order.tickets?.length !== quantity || !paid.body.order.tickets.every((t) => t.qrCode)) {
    throw new Error(`Không xác nhận được vé (${paid.status}): ${JSON.stringify(paid.body)}`);
  }
  return paid.body.order;
}

const scan = (user, event, qrCode) => request(user.token, `/events/${event.id}/check-in`, 'POST', { qrCode });
const ticketRow = (ticket) => prisma.ticket.findUnique({ where: { id: ticket.id } });
const untouched = (ticket) => ticket?.checkedInAt === null && ticket?.checkedInById === null;

async function main() {
  console.log(`\n${D}Soát vé QR${X}`);
  const organizer = await createUser('organizer', 'ORGANIZER');
  const stranger = await createUser('stranger', 'ORGANIZER');
  const customer = await createUser('customer', 'CUSTOMER');
  const admin = await createUser('admin', 'ADMIN');
  const event = await createEvent(organizer.id);
  const other = await createEvent(organizer.id);
  const confirmed = await book(customer, event, 4);
  const [first, restricted, concurrent, unscanned] = confirmed.tickets;
  const foreign = (await book(customer, other, 1)).tickets[0];
  const pending = await book(customer, event, 1, false);
  const pendingTicket = await prisma.ticket.update({
    where: { id: pending.tickets[0].id }, data: { qrCode: randomUUID() },
  });

  console.log(`\n${D}1. Vé hợp lệ và quét lại${X}`);
  const valid = await scan(organizer, event, first.qrCode);
  const firstRow = await ticketRow(first);
  const firstTime = valid.body?.ticket?.checkedInAt;
  check('chủ sự kiện quét -> 200 VALID', valid.status === 200 && valid.body?.result === 'VALID');
  check('DB lưu thời điểm và người soát vé', Boolean(firstTime) &&
    firstRow?.checkedInAt?.toISOString() === firstTime && firstRow.checkedInById === organizer.id);
  const again = await scan(organizer, event, first.qrCode);
  check('quét lại -> 409 ALREADY_USED, giữ thời điểm đầu', again.status === 409 &&
    again.body?.result === 'ALREADY_USED' && Boolean(firstTime) && again.body?.ticket?.checkedInAt === firstTime);
  const afterAgain = await ticketRow(first);
  check('quét lại không ghi đè DB', Boolean(firstTime) && afterAgain?.checkedInAt?.toISOString() === firstTime &&
    afterAgain.checkedInById === organizer.id);

  console.log(`\n${D}2. Mã lạ và vé khác sự kiện${X}`);
  const missing = await scan(organizer, event, randomUUID());
  check('mã không tồn tại -> 404 NOT_FOUND', missing.status === 404 && missing.body?.result === 'NOT_FOUND');
  const wrong = await scan(organizer, event, foreign.qrCode);
  check('vé sự kiện khác cùng chủ -> 409 WRONG_EVENT', wrong.status === 409 && wrong.body?.result === 'WRONG_EVENT');
  check('vé khác sự kiện chưa bị đánh dấu', untouched(await ticketRow(foreign)));

  console.log(`\n${D}3. Phân quyền${X}`);
  const denied = await scan(stranger, event, restricted.qrCode);
  check('organizer khác -> 403', denied.status === 403, `nhận ${denied.status}`);
  check('organizer khác không đánh dấu vé', untouched(await ticketRow(restricted)));
  const deniedCustomer = await scan(customer, event, restricted.qrCode);
  check('CUSTOMER -> 403', deniedCustomer.status === 403, `nhận ${deniedCustomer.status}`);
  check('CUSTOMER không đánh dấu vé', untouched(await ticketRow(restricted)));
  const byAdmin = await scan(admin, event, restricted.qrCode);
  check('ADMIN quét -> 200 VALID', byAdmin.status === 200 && byAdmin.body?.result === 'VALID');
  const adminRow = await ticketRow(restricted);
  check('DB lưu ADMIN là người soát vé', Boolean(adminRow?.checkedInAt) && adminRow.checkedInById === admin.id);

  console.log(`\n${D}4. Đơn chưa thanh toán và dữ liệu không hợp lệ${X}`);
  check('đơn kiểm thử vẫn PENDING', (await prisma.order.findUnique({ where: { id: pending.id } }))?.status === 'PENDING');
  const unpaid = await scan(organizer, event, pendingTicket.qrCode);
  check('vé PENDING có QR -> 409 NOT_CONFIRMED', unpaid.status === 409 && unpaid.body?.result === 'NOT_CONFIRMED');
  check('vé PENDING chưa bị đánh dấu', untouched(await ticketRow(pendingTicket)));
  const empty = await scan(organizer, event, '');
  check('qrCode rỗng -> 400', empty.status === 400, `nhận ${empty.status}`);
  const absentEvent = { id: randomUUID() };
  const absent = await scan(organizer, absentEvent, unscanned.qrCode);
  check('soát vé sự kiện không tồn tại -> 404', absent.status === 404, `nhận ${absent.status}`);
  check('request không hợp lệ không đánh dấu vé', untouched(await ticketRow(unscanned)));

  console.log(`\n${D}5. Hai mươi request đồng thời${X}`);
  const results = await Promise.all(Array.from({ length: 20 }, () => scan(organizer, event, concurrent.qrCode)));
  const validCount = results.filter((r) => r.status === 200 && r.body?.result === 'VALID').length;
  const usedCount = results.filter((r) => r.status === 409 && r.body?.result === 'ALREADY_USED').length;
  check('đúng 1 VALID và 19 ALREADY_USED', validCount === 1 && usedCount === 19,
    `${validCount} VALID, ${usedCount} ALREADY_USED; status ${results.map((r) => r.status).join()}`);
  const raceRow = await ticketRow(concurrent);
  check('DB chỉ ghi nhận người soát và một thời điểm chung', Boolean(raceRow?.checkedInAt) &&
    raceRow.checkedInById === organizer.id &&
    results.every((r) => r.body?.ticket?.checkedInAt === raceRow.checkedInAt.toISOString()));

  console.log(`\n${D}6. Vé của khách hàng và thống kê${X}`);
  const orders = await request(customer.token, '/orders/my-orders');
  const returnedTicket = orders.body?.data?.find((o) => o.id === confirmed.id)?.tickets?.find((t) => t.id === first.id);
  check('my-orders trả checkedInAt sau khi quét', orders.status === 200 && Boolean(firstTime) &&
    returnedTicket?.checkedInAt === firstTime);
  const stats = await request(organizer.token, `/events/${event.id}/check-in/stats`);
  check('stats chỉ đếm 4 vé CONFIRMED, đã quét 3 vé', stats.status === 200 &&
    stats.body?.data?.eventId === event.id && stats.body?.data?.total === 4 && stats.body?.data?.checkedIn === 3,
    JSON.stringify(stats.body?.data));
  check('vé CONFIRMED còn lại chưa quét', untouched(await ticketRow(unscanned)));
  const forbiddenStats = await request(stranger.token, `/events/${event.id}/check-in/stats`);
  check('organizer khác xem stats -> 403', forbiddenStats.status === 403, `nhận ${forbiddenStats.status}`);
  const missingStats = await request(organizer.token, `/events/${absentEvent.id}/check-in/stats`);
  check('stats sự kiện không tồn tại -> 404', missingStats.status === 404, `nhận ${missingStats.status}`);
}

async function cleanup() {
  // Tiếp tục dọn các nhóm còn lại nếu một thao tác lỗi, đồng thời báo bộ test thất bại.
  const remove = async (action) => {
    try { await action(); } catch (error) {
      check('dọn dữ liệu kiểm thử', false, error.message);
    }
  };
  await remove(() => prisma.order.deleteMany({ where: { userId: { in: users } } }));
  for (const id of eventIds) await remove(() => prisma.event.delete({ where: { id } }));
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
