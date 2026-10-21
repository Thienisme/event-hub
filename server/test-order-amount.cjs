/**
 * Kiểm chứng đường đặt vé sau khi đổi kiểu cột orders.totalAmount:
 * DECIMAL(10,2) -> DECIMAL(12,2).
 *
 * Cần kiểm: tổng tiền của đơn (price * số lượng) phải lưu và đọc lại chính xác,
 * kể cả khi vượt biên cũ của DECIMAL(10,2).
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://localhost:5000/api';

const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ${G}✅${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ${R}❌${X} ${name}${detail ? ` ${D}— ${detail}${X}` : ''}`);
  }
}

// Tài khoản và dữ liệu tạo ra trong test nằm ở PHẠM VI MODULE để hàm
// `cleanup()` dọn được cả khi test lỗi giữa chừng.
//
// Trước đây việc dọn nằm ở cuối happy path, còn `main().catch()` chỉ in lỗi rồi
// thoát — nên một lần chạy bị lỗi (ví dụ rate limiter chặn login) là để lại
// tài khoản ADMIN trong DB với mật khẩu đã biết. Tài khoản rác đó tích luỹ dần
// và làm bảng "Quản trị người dùng" lẫn logic "bảo vệ admin cuối cùng" khó
// kiểm chứng.
let testUserId = null;
const createdEventIds = [];

async function cleanup() {
  // Xoá ORDER trước: `Order.userId` là FK Restrict, nên chừa lại order là
  // user không xoá được. Order xoá thì cascade xoá luôn Ticket.
  await prisma.order.deleteMany({ where: { userId: testUserId } }).catch(() => {});
  // Xoá event TỪNG CÁI thay vì `deleteMany`: `deleteMany` với điều kiện quan hệ
  // sinh câu truy vấn mà MySQL không xử lý được (lỗi 1093) và bị nuốt bởi
  // `.catch()`, khiến user không xoá được vì còn event trỏ tới.
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  if (testUserId) {
    await prisma.adminAuditLog
      .deleteMany({ where: { OR: [{ actorId: testUserId }, { targetId: testUserId }] } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  }
}

async function main() {
  console.log(`\n${D}Kiểm chứng đường đặt vé sau khi đổi kiểu cột totalAmount${X}`);

  // Tài khoản RIÊNG cho test này: rate limiter đặt vé khoá theo tài khoản
  // (15 lần/5 phút), dùng chung với k6 hay test khác sẽ hụt hạn mức.
  const bcrypt = require('bcryptjs');
  const email = `order-amount-${Date.now()}@test.local`;
  const password = 'MatKhauDaiHon8KyTu';
  const testUser = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      fullName: 'Order Amount Test',
      role: 'ADMIN',
      isActive: true,
    },
    select: { id: true },
  });
  testUserId = testUser.id;

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await login.json();
  if (!token) throw new Error('Khong dang nhap duoc');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });

  // Tạo sự kiện có vé giá 2.000.000,50 x 200 vé.
  //
  // Dùng giá có phần thập phân để kiểm chứng luôn việc làm tròn 2 chữ số thập
  // phân của DECIMAL(12,2) — giá trị "đẹp" (1.000.000) sẽ không bắt được lỗi
  // làm tròn.
  const event = await prisma.event.create({
    data: {
      title: 'DIAG don hang',
      description: 'don tien',
      location: 'HN',
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 90000000),
      organizerId: admin.id,
      ticketTypes: {
        create: [{ name: 'STANDARD', price: 2000000.5, totalQuantity: 200, availableQuantity: 200 }],
      },
    },
    include: { ticketTypes: true },
  });
  const ticketType = event.ticketTypes[0];

  // Đặt 50 vé x 2.000.000,50 = 100.000.025 (vượt biên DECIMAL(10,2) cũ là
  // 99.999.999,99). Số vé đặt trong một đơn có trần 100, nên 50 nằm thoải mái
  // trong giới hạn.
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ticketTypeId: ticketType.id, quantity: 50 }),
  });
  const body = await res.json().catch(() => null);
  check('đặt 50 vé x 2.000.000,50 -> 201', res.status === 201, `nhận ${res.status} — "${(body || {}).message}"`);

  if (res.status === 201) {
    const order = await prisma.order.findUnique({
      where: { id: body.order.id },
      select: { totalAmount: true, status: true },
    });
    check(
      'tổng tiền 100.000.025 lưu và đọc lại chính xác',
      order && Number(order.totalAmount) === 100000025,
      `totalAmount = ${order ? order.totalAmount : 'null'}`
    );
  }

  // Dọn dẹp (kể cả khi lỗi — xem `cleanup()` ở đầu file)
  createdEventIds.push(event.id);
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
