/**
 * Test end-to-end: ràng buộc quan hệ giữa các field trong schema.
 *
 * Bao gồm:
 *   - `endTime` phải SAU `startTime` (cả đường POST và đường PUT).
 *   - Đăng ký không được tự chọn role: server luôn gán CUSTOMER, kể cả khi
 *     client gửi `role: "ORGANIZER"` hoặc `role: "ADMIN"`.
 *
 * Kỳ vọng sau bản vá:
 *   - endTime <= startTime  -> 400 kèm thông báo tiếng Việt nêu rõ trường.
 *   - Sự kiện hợp lệ        -> 201 / 200 như trước.
 *   - Register kèm role    -> 201 nhưng user trong DB có role CUSTOMER.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

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
  console.log(`\n${D}Test ràng buộc schema — thời gian sự kiện & role khi đăng ký${X}`);

  // Tài khoản RIÊNG cho test này (lý do giống test-event-limits: rate limiter
  // đặt vé khoá theo tài khoản, dùng chung sẽ hụt hạn mức).
  const email = `validation-admin-${Date.now()}@test.local`;
  const password = 'MatKhauDaiHon8KyTu';
  const testUser = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      fullName: 'Validation Test Admin',
      role: 'ADMIN',
      isActive: true,
    },
    select: { id: true },
  });
  const testUserId = testUser.id;

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await login.json();
  if (!token) throw new Error('Khong dang nhap duoc');

  const created = [];

  const post = async (payload) => {
    const res = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (body && body.event) created.push(body.event.id);
    return { status: res.status, message: (body || {}).message || '' };
  };

  const start = new Date(Date.now() + 86400000);
  const end = new Date(Date.now() + 90000000);

  const base = {
    title: 'Sự kiện kiểm thử ràng buộc',
    description: null,
    location: 'Hà Nội',
    bannerUrl: null,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    ticketTypes: [{ name: 'STANDARD', price: 100000, totalQuantity: 10 }],
  };

  // 1. Sự kiện hợp lệ -> 201 (phải giữ nguyên hành vi cũ)
  const ok = await post(base);
  check('sự kiện hợp lệ -> 201', ok.status === 201, `nhận ${ok.status} — "${ok.message}"`);

  // 2. ★ endTime TRƯỚC startTime -> 400
  const endBeforeStart = await post({
    ...base,
    title: 'Ket thuc truoc bat dau',
    startTime: end.toISOString(),
    endTime: start.toISOString(),
  });
  check(
    'endTime trước startTime -> 400 kèm thông báo rõ ràng',
    endBeforeStart.status === 400 && /kết thúc phải sau/i.test(endBeforeStart.message),
    `nhận ${endBeforeStart.status} — "${endBeforeStart.message}"`
  );

  // 3. ★ endTime BẰNG startTime -> 400 (không phải "sau" nên cũng sai)
  const endEqualStart = await post({
    ...base,
    title: 'Ket thuc cung bat dau',
    startTime: start.toISOString(),
    endTime: start.toISOString(),
  });
  check(
    'endTime bằng startTime -> 400',
    endEqualStart.status === 400 && /kết thúc phải sau/i.test(endEqualStart.message),
    `nhận ${endEqualStart.status} — "${endEqualStart.message}"`
  );

  // 4. Đường SỬA (PUT) dùng chung schema -> phải cùng hành vi.
  if (created.length) {
    const put = async (payload) => {
      const res = await fetch(`${API}/events/${created[0]}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, message: (body || {}).message || '' };
    };

    const putBad = await put({
      ...base,
      startTime: end.toISOString(),
      endTime: start.toISOString(),
    });
    check(
      'sửa sự kiện với endTime trước startTime -> 400',
      putBad.status === 400 && /kết thúc phải sau/i.test(putBad.message),
      `nhận ${putBad.status} — "${putBad.message}"`
    );

    const putOk = await put(base);
    check(
      'sửa sự kiện với thời gian hợp lệ -> 200',
      putOk.status === 200,
      `nhận ${putOk.status} — "${putOk.message}"`
    );
  }

  // 5. ★ Đăng ký có gửi kèm role -> server vẫn gán CUSTOMER.
  //
  // Schema đã bỏ field `role`, nên payload có role vẫn được chấp nhận (Zod mặc
  // định strip field lạ) nhưng role lưu vào DB phải là CUSTOMER — không bao
  // giờ là ORGANIZER hay ADMIN.
  const regEmail = `validation-user-${Date.now()}@test.local`;
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: regEmail,
      password,
      fullName: 'Validation Test User',
      role: 'ORGANIZER',
    }),
  });
  const regBody = await regRes.json().catch(() => null);
  check(
    'đăng ký kèm role: "ORGANIZER" -> 201',
    regRes.status === 201,
    `nhận ${regRes.status} — "${(regBody || {}).message || ''}"`
  );

  const regUser = await prisma.user.findUnique({
    where: { email: regEmail },
    select: { role: true },
  });
  check(
    'role trong DB vẫn là CUSTOMER dù client gửi role: "ORGANIZER"',
    regUser && regUser.role === 'CUSTOMER',
    `role thực tế: ${regUser ? regUser.role : 'không tìm thấy user'}`
  );

  // 6. ★ Đăng ký gửi role: "ADMIN" cũng không lên được ADMIN.
  const regAdminEmail = `validation-admin-claim-${Date.now()}@test.local`;
  await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: regAdminEmail,
      password,
      fullName: 'Validation Test Admin Claim',
      role: 'ADMIN',
    }),
  }).catch(() => {});
  const claimUser = await prisma.user.findUnique({
    where: { email: regAdminEmail },
    select: { role: true },
  });
  check(
    'role trong DB không bao giờ là ADMIN khi tự khai trong lúc đăng ký',
    claimUser && claimUser.role === 'CUSTOMER',
    `role thực tế: ${claimUser ? claimUser.role : 'không tìm thấy user'}`
  );

  // Dọn dẹp
  for (const id of created) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const mail of [regEmail, regAdminEmail]) {
    const u = await prisma.user.findUnique({ where: { email: mail }, select: { id: true } });
    if (!u) continue;
    await prisma.adminAuditLog
      .deleteMany({ where: { OR: [{ actorId: u.id }, { targetId: u.id }] } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
  await prisma.adminAuditLog
    .deleteMany({ where: { OR: [{ actorId: testUserId }, { targetId: testUserId }] } })
    .catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
