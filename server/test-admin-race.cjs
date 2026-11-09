/**
 * Test race: hai admin hạ quyền lẫn nhau cùng lúc.
 *
 * Tình huống: hệ thống chỉ còn đúng 2 admin (A và B). A gọi "hạ quyền B" và B
 * gọi "hạ quyền A" đồng thời. Nếu hai request cùng thấy "còn admin khác" thì cả
 * hai đều được phép -> hệ thống không còn admin nào.
 *
 * Kỳ vọng sau khi sửa (transaction + SELECT ... FOR UPDATE):
 *   - tối đa MỘT trong hai request được phép;
 *   - luôn còn ít nhất một admin đang hoạt động.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

/**
 * Chặn chạy nhầm trên dữ liệu thật.
 *
 * Test này hạ quyền TOÀN BỘ admin đang có để dựng đúng tiền đề 2 admin, nên
 * chạy trên database thật sẽ làm mất quyền quản trị của hệ thống. Chỉ cho chạy
 * khi DATABASE_URL trỏ tới máy chủ cục bộ (localhost, 127.0.0.1 hoặc ::1) VÀ
 * tên database trông giống môi trường phát triển, hoặc khi người chạy đã
 * xác nhận rõ ràng bằng ALLOW_DESTRUCTIVE_TESTS=true.
 */
const SAFE_DB_MARKERS = ['test', 'dev', 'verify', 'eventhub'];
// new URL() trả host IPv6 kèm ngoặc vuông nên ::1 có dạng [::1].
const SAFE_DB_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const assertSafeDatabase = () => {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS === 'true') return;

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '❌ Từ chối chạy test-admin-race.cjs vì NODE_ENV=production. ' +
        'Đặt ALLOW_DESTRUCTIVE_TESTS=true nếu thật sự muốn chạy trên database này.'
    );
    process.exit(1);
  }

  // Tách host bằng new URL(); nếu URL sai định dạng thì chặn luôn, in host là "(không phân tích được)".
  const url = process.env.DATABASE_URL || '';
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    console.error(
      '❌ Từ chối chạy test-admin-race.cjs: DATABASE_URL không phân tích được ' +
        `(host hiện tại: "(không phân tích được)"). ` +
        'Test này tạm hạ quyền toàn bộ admin, chỉ cho chạy với database cục bộ. ' +
        'Đặt ALLOW_DESTRUCTIVE_TESTS=true nếu chắc chắn.'
    );
    process.exit(1);
  }

  // Host phải là máy cục bộ: dấu hiệu "eventhub" trong tên database không thay thế được bước này,
  // nên vẫn chặn khi DATABASE_URL trỏ tới máy chủ thật dù tên database chứa "eventhub".
  if (!SAFE_DB_HOSTS.includes(hostname)) {
    console.error(
      `❌ Từ chối chạy test-admin-race.cjs: host của DATABASE_URL là "${hostname}" ` +
        `không phải máy cục bộ (localhost, 127.0.0.1, ::1). ` +
        'Test này tạm hạ quyền toàn bộ admin. Đặt ALLOW_DESTRUCTIVE_TESTS=true nếu chắc chắn.'
    );
    process.exit(1);
  }

  // Bỏ query string, bỏ dấu "/" cuối, rồi lấy đoạn cuối của path làm tên database.
  const database = url.split('?')[0].replace(/\/+$/, '').split('/').pop() || '';
  const isSafe = SAFE_DB_MARKERS.some((marker) => database.toLowerCase().includes(marker));

  if (!isSafe) {
    console.error(
      `❌ Từ chối chạy test-admin-race.cjs: database "${database}" không chứa ` +
        `một trong các dấu hiệu an toàn (${SAFE_DB_MARKERS.join(', ')}). ` +
        'Test này tạm hạ quyền toàn bộ admin. Đặt ALLOW_DESTRUCTIVE_TESTS=true nếu chắc chắn.'
    );
    process.exit(1);
  }
};

assertSafeDatabase();

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const API = process.env.BASE_URL || 'http://localhost:5000/api';
const prisma = new PrismaClient();

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

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  return body && body.token ? body.token : null;
}

async function demote(token, targetId) {
  const res = await fetch(`${API}/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role: 'CUSTOMER' }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, message: (body || {}).message || '' };
}

async function main() {
  console.log(`\n${D}Test race — hai admin hạ quyền lẫn nhau${X}`);

  // Chuẩn bị: đúng 2 admin (A, B) và admin@test.com bị hạ quyền tạm để tránh
  // can thiệp vào phép thử. Mật khẩu đặt sẵn để đăng nhập được.
  const passwordHash = await bcrypt.hash('MatKhauDaiHon8KyTu', 10);
  const created = [];

  // Dọn tàn dư của các lần chạy trước: user `race-admin-*` còn sót lại sẽ làm
  // sai tiền đề (hệ thống có nhiều hơn 2 admin) và làm test cho kết quả sai.
  // Xoá theo thứ tự: audit log -> user.
  const leftovers = await prisma.user.findMany({
    where: { email: { startsWith: 'race-admin-' } },
    select: { id: true },
  });
  for (const old of leftovers) {
    await prisma.adminAuditLog
      .deleteMany({ where: { OR: [{ actorId: old.id }, { targetId: old.id }] } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: old.id } }).catch(() => {});
  }

  // Hạ quyền TẤT CẢ admin có sẵn (không chỉ admin@test.com): nếu còn sót một
  // admin nào khác, phép thử sẽ cho phép cả hai request hạ quyền — đúng hành vi
  // đúng, nhưng sai tiền đề của bài toán race.
  //
  // Phải chụp danh sách TRƯỚC khi tạo A và B, nếu không A và B cũng bị tính
  // vào và bị hạ quyền theo.
  const preExistingAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });

  // ★ Mọi thao tác làm thay đổi quyền PHẢI nằm trong `try` để `finally` luôn
  // chạy được. Trước đây `updateMany` (hạ quyền toàn bộ admin) nằm NGOÀI try:
  // nếu `user.create` hoặc bất kỳ lệnh nào phía sau lỗi, hệ thống bị bỏ lại
  // KHÔNG CÒN admin nào — và test tiếp theo cũng không cứu được, vì mọi admin
  // đều đã mất quyền.
  try {
    await prisma.user.updateMany({
      where: { role: 'ADMIN' },
      data: { role: 'CUSTOMER' },
    });

    for (const tag of ['A', 'B']) {
      const email = `race-admin-${tag}-${Date.now()}@test.local`;
      const user = await prisma.user.create({
        data: {
          email,
          password: passwordHash,
          fullName: `Race Admin ${tag}`,
          role: 'ADMIN',
          isActive: true,
        },
        select: { id: true, email: true },
      });
      created.push(user);
    }

    const [a, b] = created;
    const tokenA = await login(a.email, 'MatKhauDaiHon8KyTu');
    const tokenB = await login(b.email, 'MatKhauDaiHon8KyTu');

    check('đăng nhập được cả hai admin', Boolean(tokenA && tokenB));

    if (tokenA && tokenB) {
      // Hai request CÙNG LÚC chạy.
      const [resA, resB] = await Promise.all([
        demote(tokenA, b.id),
        demote(tokenB, a.id),
      ]);

      const okCount = [resA, resB].filter((r) => r.status === 200).length;
      // Request thua có hai cách bị chặn, đều đúng:
      //   400: cùng vào transaction, và thấy mình sẽ hạ quyền admin cuối cùng;
      //   403: tới sau khi người gửi vừa bị hạ quyền, nên không còn quyền admin.
      const blocked = [resA, resB].filter((r) => r.status !== 200);

      check(
        'đúng một request được phép (không cả hai)',
        okCount === 1,
        `thành công ${okCount}/2 (${resA.status}, ${resB.status})`
      );

      check(
        'request bị chặn trả 400 hoặc 403 kèm lý do rõ ràng',
        blocked.length === 1 &&
          blocked.every(
            (r) =>
              (r.status === 400 && /admin cuối cùng/i.test(r.message)) ||
              (r.status === 403 && /không có quyền/i.test(r.message))
          ),
        blocked.map((r) => `${r.status} "${r.message}"`).join(' | ') || 'không có request nào bị chặn'
      );

      // Sau race, hệ thống phải còn ít nhất một admin đang hoạt động.
      const remainingAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      check(
        'vẫn còn ít nhất một admin đang hoạt động',
        remainingAdmins >= 1,
        `còn ${remainingAdmins} admin`
      );
    }
  } finally {
    // Dọn dẹp: trả về quyền ADMIN cho các admin có sẵn, xoá user thử.
    for (const admin of preExistingAdmins) {
      await prisma.user
        .update({ where: { id: admin.id }, data: { role: 'ADMIN' } })
        .catch(() => {});
    }
    for (const user of created) {
      await prisma.adminAuditLog
        .deleteMany({ where: { OR: [{ actorId: user.id }, { targetId: user.id }] } })
        .catch(() => {});
      // `Order.userId` là FK Restrict: xoá order trước rồi mới xoá được user.
      await prisma.order.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  }

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
