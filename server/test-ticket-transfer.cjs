/**
 * Chuyển nhượng vé: quyền, điều kiện, mã cũ chết ngay, tranh chấp chuyển đồng thời
 * và tranh chấp chuyển với soát vé. Yêu cầu: server đang chạy, cùng DATABASE_URL
 * (database test). Email chỉ kiểm khi có MAIL_OUTBOX_DIR dùng chung với server.
 * Dùng: npm run test:transfer.
 */
require('dotenv').config();
const { randomUUID, createHmac } = require('crypto');
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
  const email = `transfer-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: `Transfer ${tag}`, role },
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
      title: 'TRANSFER',
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

// Tự tính theo hợp đồng, không dùng helper của server để tránh kiểm thử lặp lại code.
function dynamicQr(ticket, delta = 0) {
  const step = Math.floor(Date.now() / 30000) + delta;
  const message = `EH1.${ticket.id}.${step}`;
  const sig = createHmac('sha256', Buffer.from(ticket.qrCode, 'utf8'))
    .update(message).digest().subarray(0, 16).toString('base64url');
  return `${message}.${sig}`;
}

const fs = require('fs/promises');
const path = require('path');
const transfer = (user, ticketId, email) => request(user.token, `/tickets/${ticketId}/transfer`, 'POST', { email });
const emailOf = (user) => prisma.user.findUnique({ where: { id: user.id }, select: { email: true } }).then(u => u.email);
const myOrders = (user) => request(user.token, '/orders/my-orders');

async function main() {
  console.log(`\n${D}Chuyển nhượng vé${X}`);
  const organizer = await createUser('organizer', 'ORGANIZER');
  const buyer = await createUser('buyer', 'CUSTOMER');
  const friend = await createUser('friend', 'CUSTOMER');
  const third = await createUser('third', 'CUSTOMER');
  const stranger = await createUser('stranger', 'CUSTOMER');
  const event = await createEvent(organizer.id);

  console.log(`\n${D}1. Chuyển thành công, mã cũ chết ngay${X}`);
  const order = await book(buyer, event, 3);
  const [t1, t2, t3] = order.tickets;
  const oldDynamic = dynamicQr(t1);
  const ok = await transfer(buyer, t1.id, await emailOf(friend));
  check('chuyển vé -> 200', ok.status === 200 && ok.body?.transfer?.toUser?.fullName === 'Transfer friend', `nhận ${ok.status} ${JSON.stringify(ok.body)}`);
  const row = await ticketRow(t1);
  check('DB: holderId là người nhận, qrCode mới', row.holderId === friend.id && row.qrCode && row.qrCode !== t1.qrCode);
  const transfers = await prisma.ticketTransfer.findMany({ where: { ticketId: t1.id } });
  check('DB: một dòng lịch sử chuyển', transfers.length === 1 && transfers[0].fromUserId === buyer.id && transfers[0].toUserId === friend.id);

  const buyerView = (await myOrders(buyer)).body?.data?.find(o => o.id === order.id)?.tickets?.find(t => t.id === t1.id);
  check('người mua: transferred true, qrCode null, chỉ có tên người nhận', buyerView?.transferred === true && buyerView.qrCode === null &&
    buyerView.transferredTo?.fullName === 'Transfer friend' && !JSON.stringify(buyerView).includes(row.qrCode));
  const keptView = (await myOrders(buyer)).body?.data?.find(o => o.id === order.id)?.tickets?.find(t => t.id === t2.id);
  check('vé còn giữ: transferred false, vẫn có qrCode', keptView?.transferred === false && keptView.qrCode === t2.qrCode);
  const getOrder = await request(buyer.token, `/orders/${order.id}`);
  check('GET /orders/:id không lộ qrCode mới', getOrder.status === 200 && !JSON.stringify(getOrder.body).includes(row.qrCode));
  const reconfirm = await request(buyer.token, `/orders/${order.id}/confirm`, 'POST');
  check('confirm lại không lộ qrCode mới', reconfirm.status === 200 && !JSON.stringify(reconfirm.body).includes(row.qrCode));

  const friendOrders = await myOrders(friend);
  const received = friendOrders.body?.receivedTickets?.find(t => t.id === t1.id);
  check('người nhận thấy vé trong receivedTickets với qrCode mới', received?.qrCode === row.qrCode &&
    received.fromUser?.fullName === 'Transfer buyer' && received.ticketType?.event?.id === event.id);

  const oldStatic = await scan(organizer, event, t1.qrCode);
  check('mã tĩnh cũ -> NOT_FOUND', oldStatic.status === 404 && oldStatic.body?.result === 'NOT_FOUND');
  const oldDyn = await scan(organizer, event, oldDynamic);
  check('QR động tính từ mã cũ -> NOT_FOUND', oldDyn.status === 404 && oldDyn.body?.result === 'NOT_FOUND');

  console.log(`\n${D}2. Quyền và chuyển tiếp${X}`);
  const again = await transfer(buyer, t1.id, await emailOf(third));
  check('người mua chuyển lại vé đã chuyển -> 404', again.status === 404, `nhận ${again.status}`);
  const foreign = await transfer(stranger, t2.id, await emailOf(stranger));
  check('người lạ chuyển vé của người khác -> 404', foreign.status === 404, `nhận ${foreign.status}`);
  const missing = await transfer(buyer, randomUUID(), await emailOf(friend));
  check('vé không tồn tại -> 404 cùng thông báo', missing.status === 404 && missing.body?.message === foreign.body?.message);
  const forward = await transfer(friend, t1.id, await emailOf(third));
  check('người nhận chuyển tiếp cho người thứ ba -> 200', forward.status === 200, `nhận ${forward.status}`);
  const friendAfter = await myOrders(friend);
  check('vé biến khỏi receivedTickets của người nhận đầu', !friendAfter.body?.receivedTickets?.some(t => t.id === t1.id));
  const thirdOrders = await myOrders(third);
  check('người thứ ba thấy người chuyển là người nhận đầu', thirdOrders.body?.receivedTickets?.find(t => t.id === t1.id)?.fromUser?.fullName === 'Transfer friend');
  const finalCode = (await ticketRow(t1)).qrCode;
  const valid = await scan(organizer, event, finalCode);
  check('mã của người giữ cuối -> VALID, holderName là người giữ', valid.status === 200 && valid.body?.ticket?.holderName === 'Transfer third');
  const usedTransfer = await transfer(third, t1.id, await emailOf(buyer));
  check('vé đã check-in -> 409 ALREADY_CHECKED_IN', usedTransfer.status === 409 && usedTransfer.body?.code === 'ALREADY_CHECKED_IN');

  console.log(`\n${D}3. Dữ liệu không hợp lệ${X}`);
  const self = await transfer(buyer, t2.id, await emailOf(buyer));
  check('chuyển cho chính mình -> 400', self.status === 400, `nhận ${self.status}`);
  const nobody = await transfer(buyer, t2.id, `khong-ton-tai-${stamp}@test.local`);
  check('email không có tài khoản -> 404', nobody.status === 404, `nhận ${nobody.status}`);
  const badEmail = await transfer(buyer, t2.id, 'khong-phai-email');
  check('email sai định dạng -> 400', badEmail.status === 400, `nhận ${badEmail.status}`);
  await prisma.user.update({ where: { id: stranger.id }, data: { isActive: false } });
  const locked = await transfer(buyer, t2.id, await emailOf(stranger));
  check('tài khoản bị khoá -> 404', locked.status === 404, `nhận ${locked.status}`);
  const pending = await book(buyer, event, 1, false);
  const unpaid = await transfer(buyer, pending.tickets[0].id, await emailOf(friend));
  check('đơn PENDING -> 409 NOT_CONFIRMED', unpaid.status === 409 && unpaid.body?.code === 'NOT_CONFIRMED');
  const startedEvent = await createEvent(organizer.id);
  const startedOrder = await book(buyer, startedEvent, 1);
  await prisma.event.update({ where: { id: startedEvent.id }, data: { startTime: new Date(Date.now() - 60_000) } });
  const started = await transfer(buyer, startedOrder.tickets[0].id, await emailOf(friend));
  check('sự kiện đã bắt đầu -> 409 EVENT_STARTED', started.status === 409 && started.body?.code === 'EVENT_STARTED');
  check('các lần từ chối không đổi vé', (await ticketRow(t2)).qrCode === t2.qrCode && (await ticketRow(t2)).holderId === null);

  console.log(`\n${D}4. Mười lệnh chuyển đồng thời cùng một vé${X}`);
  const racer = await createUser('racer', 'CUSTOMER');
  const raceTicket = (await book(racer, event, 1)).tickets[0];
  // Người nhận chỉ cần email, không cần đăng nhập (10 lần đăng nhập đồng thời sẽ chạm authRateLimiter).
  const targets = [];
  for (let i = 0; i < 10; i += 1) {
    const user = await prisma.user.create({
      data: { email: `transfer-target${i}-${stamp}@test.local`, password: 'x', fullName: `Transfer target${i}` },
      select: { id: true },
    });
    users.push(user.id);
    targets.push(user);
  }
  const emails = await Promise.all(targets.map(emailOf));
  const results = await Promise.all(emails.map(email => transfer(racer, raceTicket.id, email)));
  const wins = results.filter(r => r.status === 200);
  // Người thua nhận 409 TICKET_CHANGED nếu đọc vé trước khi người thắng commit,
  // hoặc 404 nếu đọc sau (lúc đó đã không còn là người giữ vé). Cả hai đều đúng.
  const losses = results.filter(r => (r.status === 409 && r.body?.code === 'TICKET_CHANGED') || r.status === 404);
  check('đúng 1 thành công, 9 bị từ chối (409 TICKET_CHANGED hoặc 404)', wins.length === 1 && losses.length === 9, results.map(r => r.status).join(','));
  const raceRow = await ticketRow(raceTicket);
  const raceHistory = await prisma.ticketTransfer.findMany({ where: { ticketId: raceTicket.id } });
  const winner = targets.find(t => t.id === raceRow.holderId);
  check('DB: đúng 1 dòng lịch sử, holderId là người thắng', raceHistory.length === 1 && raceHistory[0].toUserId === raceRow.holderId &&
    winner && wins[0].body?.transfer?.toUser?.fullName === `Transfer target${targets.indexOf(winner)}`);

  console.log(`\n${D}5. Chuyển vé đồng thời với soát vé mã cũ${X}`);
  let bothWon = 0; let neitherWon = 0; const outcomes = {};
  for (let i = 0; i < 10; i += 1) {
    const holder = await createUser(`gate${i}`, 'CUSTOMER');
    const ticket = (await book(holder, event, 1)).tickets[0];
    const [checked, moved] = await Promise.all([
      scan(organizer, event, i % 2 ? dynamicQr(ticket) : ticket.qrCode),
      transfer(holder, ticket.id, emails[i]),
    ]);
    const key = `${checked.body?.result}/${moved.status}${moved.body?.code ? ` ${moved.body.code}` : ''}`;
    outcomes[key] = (outcomes[key] || 0) + 1;
    if (checked.body?.result === 'VALID' && moved.status === 200) bothWon += 1;
    if (checked.body?.result !== 'VALID' && moved.status !== 200) neitherWon += 1;
    const final = await ticketRow(ticket);
    if (checked.body?.result === 'VALID' && (final.holderId !== null || final.qrCode !== ticket.qrCode)) bothWon += 1;
  }
  check('không lần nào cả soát vé lẫn chuyển vé cùng thành công', bothWon === 0, JSON.stringify(outcomes));
  check('mỗi lần đúng một bên thắng', neitherWon === 0, JSON.stringify(outcomes));

  console.log(`\n${D}6. Email${X}`);
  const outbox = process.env.MAIL_OUTBOX_DIR;
  if (!outbox) {
    console.log(`  ${D}bỏ qua: không đặt MAIL_OUTBOX_DIR${X}`);
  } else {
    await new Promise(r => setTimeout(r, 500));
    const friendEmail = await emailOf(friend);
    const mails = [];
    for (const file of await fs.readdir(outbox).catch(() => [])) {
      const mail = await fs.readFile(path.join(outbox, file), 'utf8').then(JSON.parse).catch(() => null);
      if (mail?.to === friendEmail) mails.push(mail);
    }
    const codes = [t1.qrCode, row.qrCode, finalCode];
    check('người nhận có email báo nhận vé', mails.some(m => /nhận vé/.test(m.subject)), `${mails.length} thư`);
    check('email nhận vé không chứa mã vé', mails.length > 0 && mails.every(m => !codes.some(c => JSON.stringify(m).includes(c))));
  }
}

async function cleanup() {
  const remove = async (action) => {
    try { await action(); } catch (error) {
      check('dọn dữ liệu kiểm thử', false, error.message);
    }
  };
  // Xoá đơn trước (Cascade xoá vé và lịch sử chuyển) vì holderId/lịch sử là FK Restrict tới users.
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
