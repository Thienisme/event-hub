/**
 * Nhân viên soát vé theo sự kiện: quyền quản lý, quyền soát vé chỉ ở đúng sự kiện,
 * không dò được mã ở sự kiện khác, gỡ là mất quyền ngay, thêm trùng/vượt trần khi
 * gửi đồng thời. Yêu cầu: server đang chạy, cùng DATABASE_URL (database test).
 * Email chỉ kiểm khi có MAIL_OUTBOX_DIR dùng chung với server.
 * Dùng: npm run test:staff.
 */
require('dotenv').config();
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');
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

const emailFor = (tag) => `staff-${tag}-${stamp}@test.local`;

/** Tạo user thẳng qua Prisma; chỉ đăng nhập khi cần token (auth rate limit 5 lỗi/phút). */
async function createUser(tag, role, { login = true, isActive = true } = {}) {
  const email = emailFor(tag);
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: `Staff ${tag}`, role, isActive },
    select: { id: true },
  });
  users.push(user.id);
  if (!login) return { id: user.id, email };
  const res = await request('', '/auth/login', 'POST', { email, password });
  if (res.status !== 200 || !res.body?.token) throw new Error(`Không đăng nhập được (${res.status})`);
  return { id: user.id, email, token: res.body.token };
}

async function createEvent(organizerId, title) {
  const event = await prisma.event.create({
    data: {
      slug: `su-kien-${randomUUID()}`,
      title,
      location: 'HN',
      startTime: new Date(Date.now() + DAY),
      endTime: new Date(Date.now() + DAY * 2),
      organizerId,
      ticketTypes: { create: [{ name: 'A', price: 1000, totalQuantity: 50, availableQuantity: 50 }] },
    },
    include: { ticketTypes: true },
  });
  eventIds.push(event.id);
  return { id: event.id, ticketTypeId: event.ticketTypes[0].id };
}

async function buyTicket(customer, event) {
  const booked = await request(customer.token, '/orders', 'POST', { ticketTypeId: event.ticketTypeId, quantity: 1 });
  if (booked.status !== 201) throw new Error(`Không đặt được vé (${booked.status}): ${JSON.stringify(booked.body)}`);
  const paid = await request(customer.token, `/orders/${booked.body.order.id}/confirm`, 'POST');
  const ticket = paid.body?.order?.tickets?.[0];
  if (paid.status !== 200 || !ticket?.qrCode) throw new Error(`Không xác nhận được vé (${paid.status})`);
  return ticket;
}

const scan = (user, event, qrCode) => request(user.token, `/events/${event.id}/check-in`, 'POST', { qrCode });
const addStaff = (user, event, email) => request(user.token, `/events/${event.id}/staff`, 'POST', { email });
const listStaff = (user, event) => request(user.token, `/events/${event.id}/staff`);
const removeStaff = (user, event, userId) => request(user.token, `/events/${event.id}/staff/${userId}`, 'DELETE');
const myCheckInEvents = (user) => request(user.token, '/check-in/events');
const isStaffFlag = async (user) => (await request(user.token, '/auth/me')).body?.user?.isCheckInStaff;

async function main() {
  console.log(`\n${D}Nhân viên soát vé${X}`);
  const organizer = await createUser('organizer', 'ORGANIZER');
  const otherOrganizer = await createUser('other-organizer', 'ORGANIZER');
  const staff = await createUser('staff', 'CUSTOMER');
  const staff2 = await createUser('staff2', 'CUSTOMER', { login: false });
  const buyer = await createUser('buyer', 'CUSTOMER');
  const locked = await createUser('locked', 'CUSTOMER', { login: false, isActive: false });
  const eventA = await createEvent(organizer.id, 'STAFF A');
  const eventB = await createEvent(otherOrganizer.id, 'STAFF B');
  const ticketA = await buyTicket(buyer, eventA);
  const ticketA2 = await buyTicket(buyer, eventA);
  const ticketB = await buyTicket(buyer, eventB);

  console.log(`\n${D}1. Chưa được gán thì không soát được${X}`);
  const before = await scan(staff, eventA, ticketA.qrCode);
  check('soát vé khi chưa là nhân viên -> 403', before.status === 403, `nhận ${before.status}`);
  check('thống kê khi chưa là nhân viên -> 403', (await request(staff.token, `/events/${eventA.id}/check-in/stats`)).status === 403);
  const emptyList = await myCheckInEvents(staff);
  check('GET /check-in/events rỗng', emptyList.status === 200 && Array.isArray(emptyList.body?.data) && emptyList.body.data.length === 0);
  check('/auth/me isCheckInStaff = false', (await isStaffFlag(staff)) === false);
  check('vé chưa bị đánh dấu', (await prisma.ticket.findUnique({ where: { id: ticketA.id } })).checkedInAt === null);

  console.log(`\n${D}2. Nhà tổ chức thêm nhân viên${X}`);
  const added = await addStaff(organizer, eventA, staff.email);
  check('thêm nhân viên -> 201', added.status === 201 && added.body?.data?.userId === staff.id, `nhận ${added.status} ${JSON.stringify(added.body)}`);
  check('DB có dòng event_staff', (await prisma.eventStaff.count({ where: { eventId: eventA.id, userId: staff.id } })) === 1);
  check('/auth/me isCheckInStaff = true', (await isStaffFlag(staff)) === true);
  const mine = await myCheckInEvents(staff);
  check('GET /check-in/events có sự kiện A, không có B', mine.status === 200 &&
    mine.body?.data?.length === 1 && mine.body.data[0].id === eventA.id && mine.body.data[0].organizerName === 'Staff organizer');
  const upper = await addStaff(organizer, eventA, `  ${staff2.email.toUpperCase()} `);
  check('email viết hoa, có khoảng trắng vẫn tìm đúng -> 201', upper.status === 201 && upper.body?.data?.userId === staff2.id, `nhận ${upper.status}`);

  console.log(`\n${D}3. Lỗi khi thêm${X}`);
  const duplicate = await addStaff(organizer, eventA, staff.email);
  check('thêm trùng -> 409', duplicate.status === 409, `nhận ${duplicate.status}`);
  const self = await addStaff(organizer, eventA, organizer.email);
  check('thêm chính nhà tổ chức -> 400', self.status === 400, `nhận ${self.status}`);
  const unknown = await addStaff(organizer, eventA, `khong-co-${stamp}@test.local`);
  check('email không có tài khoản -> 404', unknown.status === 404, `nhận ${unknown.status}`);
  const inactive = await addStaff(organizer, eventA, locked.email);
  check('tài khoản bị khoá -> 404, cùng thông báo', inactive.status === 404 && inactive.body?.message === unknown.body?.message);
  const invalid = await addStaff(organizer, eventA, 'khong-phai-email');
  check('email sai định dạng -> 400', invalid.status === 400, `nhận ${invalid.status}`);
  const missingEvent = await addStaff(organizer, { id: randomUUID() }, staff.email);
  check('sự kiện không tồn tại -> 404', missingEvent.status === 404, `nhận ${missingEvent.status}`);

  console.log(`\n${D}4. Ai được quản lý nhân viên${X}`);
  const byOther = await addStaff(otherOrganizer, eventA, buyer.email);
  check('nhà tổ chức khác thêm vào sự kiện A -> 403', byOther.status === 403, `nhận ${byOther.status}`);
  check('nhà tổ chức khác xem danh sách A -> 403', (await listStaff(otherOrganizer, eventA)).status === 403);
  check('nhà tổ chức khác gỡ nhân viên A -> 403', (await removeStaff(otherOrganizer, eventA, staff.id)).status === 403);
  const byStaff = await addStaff(staff, eventA, buyer.email);
  check('nhân viên tự thêm người khác -> 403', byStaff.status === 403, `nhận ${byStaff.status}`);
  check('nhân viên xem danh sách nhân viên -> 403', (await listStaff(staff, eventA)).status === 403);
  check('nhân viên gỡ nhân viên khác -> 403', (await removeStaff(staff, eventA, staff2.id)).status === 403);
  check('khách thường xem danh sách -> 403', (await listStaff(buyer, eventA)).status === 403);
  check('DB: không ai bị thêm ngoài 2 nhân viên', (await prisma.eventStaff.count({ where: { eventId: eventA.id } })) === 2);

  console.log(`\n${D}5. Nhân viên soát vé đúng sự kiện${X}`);
  const valid = await scan(staff, eventA, ticketA.qrCode);
  check('nhân viên soát vé A -> VALID', valid.status === 200 && valid.body?.result === 'VALID', `nhận ${valid.status} ${valid.body?.result}`);
  const row = await prisma.ticket.findUnique({ where: { id: ticketA.id } });
  check('DB: checkedInById là nhân viên', row.checkedInAt !== null && row.checkedInById === staff.id);
  const again = await scan(staff, eventA, ticketA.qrCode);
  check('quét lại -> ALREADY_USED', again.status === 409 && again.body?.result === 'ALREADY_USED');
  const stats = await request(staff.token, `/events/${eventA.id}/check-in/stats`);
  check('nhân viên xem thống kê A', stats.status === 200 && stats.body?.data?.total === 2 && stats.body.data.checkedIn === 1);
  const wrong = await scan(staff, eventA, ticketB.qrCode);
  check('vé sự kiện B quét ở A -> WRONG_EVENT', wrong.status === 409 && wrong.body?.result === 'WRONG_EVENT');
  const list = await listStaff(organizer, eventA);
  const entry = list.body?.data?.staff?.find((s) => s.userId === staff.id);
  check('danh sách nhân viên đếm số vé đã soát', list.status === 200 && list.body.data.staff.length === 2 &&
    entry?.checkedInCount === 1 && list.body.data.staff.find((s) => s.userId === staff2.id)?.checkedInCount === 0);
  const byOwner = await scan(organizer, eventA, ticketA2.qrCode);
  check('nhà tổ chức vẫn soát vé được', byOwner.status === 200 && byOwner.body?.result === 'VALID');

  console.log(`\n${D}6. Không soát, không dò mã ở sự kiện khác${X}`);
  const otherEvent = await scan(staff, eventB, ticketB.qrCode);
  const otherFake = await scan(staff, eventB, `KHONG-CO-${stamp}`);
  check('soát vé ở sự kiện B (không được gán) -> 403', otherEvent.status === 403, `nhận ${otherEvent.status}`);
  check('mã thật và mã giả ở B trả giống hệt nhau', otherEvent.status === otherFake.status &&
    otherEvent.body?.message === otherFake.body?.message && otherEvent.body?.result === undefined);
  check('vé B không bị đánh dấu', (await prisma.ticket.findUnique({ where: { id: ticketB.id } })).checkedInAt === null);
  check('thống kê sự kiện B -> 403', (await request(staff.token, `/events/${eventB.id}/check-in/stats`)).status === 403);

  console.log(`\n${D}7. Nhân viên không sửa được sự kiện${X}`);
  const put = await request(staff.token, `/events/${eventA.id}`, 'PUT', { title: 'Bị sửa', location: 'X', startTime: new Date(Date.now() + DAY).toISOString(), endTime: new Date(Date.now() + DAY * 2).toISOString() });
  check('sửa sự kiện -> 403', put.status === 403, `nhận ${put.status}`);
  check('xoá sự kiện -> 403', (await request(staff.token, `/events/${eventA.id}`, 'DELETE')).status === 403);
  check('xem mã giảm giá -> 403', (await request(staff.token, `/events/${eventA.id}/promo-codes`)).status === 403);
  check('DB: tiêu đề sự kiện không đổi', (await prisma.event.findUnique({ where: { id: eventA.id } })).title === 'STAFF A');

  console.log(`\n${D}8. Gỡ nhân viên là mất quyền ngay${X}`);
  const removed = await removeStaff(organizer, eventA, staff.id);
  check('gỡ nhân viên -> 200', removed.status === 200, `nhận ${removed.status}`);
  const ticketA3 = await buyTicket(buyer, eventA);
  const afterRemove = await scan(staff, eventA, ticketA3.qrCode);
  check('soát vé sau khi bị gỡ -> 403', afterRemove.status === 403, `nhận ${afterRemove.status}`);
  check('vé không bị đánh dấu', (await prisma.ticket.findUnique({ where: { id: ticketA3.id } })).checkedInAt === null);
  check('/check-in/events rỗng sau khi gỡ', (await myCheckInEvents(staff)).body?.data?.length === 0);
  check('/auth/me isCheckInStaff = false sau khi gỡ', (await isStaffFlag(staff)) === false);
  check('gỡ lần hai -> 404', (await removeStaff(organizer, eventA, staff.id)).status === 404);
  check('lịch sử soát vé vẫn giữ checkedInById', (await prisma.ticket.findUnique({ where: { id: ticketA.id } })).checkedInById === staff.id);

  console.log(`\n${D}9. Thêm cùng một người đồng thời${X}`);
  const same = await Promise.all(Array.from({ length: 10 }, () => addStaff(organizer, eventA, staff.email)));
  const created = same.filter((r) => r.status === 201).length;
  const conflicts = same.filter((r) => r.status === 409).length;
  check('10 request cùng lúc: đúng 1 thành công, 9 nhận 409', created === 1 && conflicts === 9, same.map((r) => r.status).join(','));
  check('DB: đúng 1 dòng', (await prisma.eventStaff.count({ where: { eventId: eventA.id, userId: staff.id } })) === 1);

  console.log(`\n${D}10. Trần nhân viên mỗi sự kiện khi thêm đồng thời${X}`);
  const limitOwner = await createUser('limit-owner', 'ORGANIZER');
  const eventC = await createEvent(limitOwner.id, 'STAFF C');
  const fillers = [];
  for (let i = 0; i < 18; i += 1) fillers.push(await createUser(`filler-${i}`, 'CUSTOMER', { login: false }));
  await prisma.eventStaff.createMany({ data: fillers.map((u) => ({ eventId: eventC.id, userId: u.id })) });
  const extra = [];
  for (let i = 0; i < 5; i += 1) extra.push(await createUser(`extra-${i}`, 'CUSTOMER', { login: false }));
  const race = await Promise.all(extra.map((u) => addStaff(limitOwner, eventC, u.email)));
  const raceOk = race.filter((r) => r.status === 201).length;
  check('18 sẵn + 5 thêm đồng thời: đúng 2 thành công (trần 20)', raceOk === 2 && race.filter((r) => r.status === 409).length === 3,
    race.map((r) => r.status).join(','));
  check('DB: đúng 20 nhân viên', (await prisma.eventStaff.count({ where: { eventId: eventC.id } })) === 20);
  const over = await addStaff(limitOwner, eventC, buyer.email);
  check('thêm người thứ 21 -> 409', over.status === 409 && /tối đa/.test(over.body?.message ?? ''), `nhận ${over.status}`);

  console.log(`\n${D}11. Xoá sự kiện thì xoá luôn danh sách nhân viên${X}`);
  const deleted = await request(limitOwner.token, `/events/${eventC.id}`, 'DELETE');
  check('xoá sự kiện C -> 200', deleted.status === 200, `nhận ${deleted.status} ${JSON.stringify(deleted.body)}`);
  check('DB: không còn dòng event_staff của C', (await prisma.eventStaff.count({ where: { eventId: eventC.id } })) === 0);

  console.log(`\n${D}12. Email báo nhân viên${X}`);
  const outbox = process.env.MAIL_OUTBOX_DIR;
  if (!outbox) {
    console.log(`  ${D}bỏ qua: không đặt MAIL_OUTBOX_DIR${X}`);
  } else {
    await new Promise((r) => setTimeout(r, 500));
    const mails = [];
    for (const file of await fs.readdir(outbox).catch(() => [])) {
      const mail = await fs.readFile(path.join(outbox, file), 'utf8').then(JSON.parse).catch(() => null);
      if (mail?.to === staff.email) mails.push(mail);
    }
    check('nhân viên có email báo được thêm', mails.some((m) => /nhân viên soát vé/.test(m.subject) && /check-in/.test(m.text)), `${mails.length} thư`);
  }
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
