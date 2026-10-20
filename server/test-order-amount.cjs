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

async function main() {
  console.log(`\n${D}Kiểm chứng đường đặt vé sau khi đổi kiểu cột totalAmount${X}`);

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'admin12345' }),
  });
  const { token } = await login.json();
  if (!token) throw new Error('Khong dang nhap duoc');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });

  // Tạo sự kiện có vé giá 1.000.000 x 50 vé = 50.000.000 (vượt biên DECIMAL(10,2)? không,
  // nhưng đặt vé giá lớn sẽ vượt). Dùng giá 1.000.000 x 100 = 100.000.000 > biên cũ.
  const event = await prisma.event.create({
    data: {
      title: 'DIAG don hang',
      description: 'don tien',
      location: 'HN',
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 90000000),
      organizerId: admin.id,
      ticketTypes: {
        create: [{ name: 'STANDARD', price: 1000000, totalQuantity: 200, availableQuantity: 200 }],
      },
    },
    include: { ticketTypes: true },
  });
  const ticketType = event.ticketTypes[0];

  // Đặt 100 vé x 1.000.000 = 100.000.000 (vượt biên DECIMAL(10,2) cũ là 99.999.999,99)
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ticketTypeId: ticketType.id, quantity: 100 }),
  });
  const body = await res.json().catch(() => null);
  check('đặt 100 vé x 1.000.000 -> 201', res.status === 201, `nhận ${res.status} — "${(body || {}).message}"`);

  if (res.status === 201) {
    const order = await prisma.order.findUnique({
      where: { id: body.order.id },
      select: { totalAmount: true, status: true },
    });
    check(
      'tổng tiền 100.000.000 lưu và đọc lại chính xác',
      order && Number(order.totalAmount) === 100000000,
      `totalAmount = ${order ? order.totalAmount : 'null'}`
    );
  }

  // Dọn dẹp
  await prisma.event.delete({ where: { id: event.id } }).catch(() => {});
  await prisma.$disconnect();

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
