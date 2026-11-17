/**
 * Hồ sơ người dùng: đổi tên, đổi mật khẩu, và thu hồi token cũ sau khi đổi mật khẩu.
 * Yêu cầu: server đang chạy, cùng DATABASE_URL với script này.
 * Dùng: npm run test:profile
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

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
const PASSWORD = 'MatKhauBanDau123';
const users = [];

async function createUser(tag) {
  const email = `profile-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(PASSWORD, 4), fullName: 'Hồ Sơ Gốc' },
    select: { id: true },
  });
  users.push(user.id);
  return { id: user.id, email, token: await login(email, PASSWORD) };
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json().catch(() => ({}))).token ?? null;
}

async function call(token, method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const changePassword = (token, currentPassword, newPassword) =>
  call(token, 'POST', '/auth/change-password', { currentPassword, newPassword });

async function testProfile(user) {
  console.log(`\n${D}1. Đổi tên${X}`);
  const ok = await call(user.token, 'PATCH', '/auth/me', { fullName: '  Tên Mới  ' });
  check('đổi tên -> 200, đã trim', ok.status === 200 && ok.body?.user?.fullName === 'Tên Mới', JSON.stringify(ok.body));
  const me = await call(user.token, 'GET', '/auth/me');
  check('/me trả tên mới', me.body?.user?.fullName === 'Tên Mới');

  const short = await call(user.token, 'PATCH', '/auth/me', { fullName: 'A' });
  check('tên 1 ký tự -> 400', short.status === 400, `nhận ${short.status}`);
  const long = await call(user.token, 'PATCH', '/auth/me', { fullName: 'A'.repeat(192) });
  check('tên 192 ký tự -> 400 (cột 191)', long.status === 400, `nhận ${long.status}`);

  const sneaky = await call(user.token, 'PATCH', '/auth/me', { fullName: 'Tên Mới', role: 'ADMIN', email: 'x@y.z' });
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  check('không đổi được role/email qua hồ sơ', sneaky.status === 200 && row.role === 'CUSTOMER' && row.email === user.email);
}

async function testAvatar(user) {
  console.log('\nẢnh đại diện');
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  async function upload(buffer, token = user.token) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'avatar.png');
    const res = await fetch(`${API}/auth/me/avatar`, {
      method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
    });
    return { status: res.status, body: await res.json() };
  }
  check('không đăng nhập không tải được avatar', (await upload(image, null)).status === 401);
  check('từ chối file giả ảnh', (await upload(Buffer.from('khong-phai-anh'))).status === 400);
  const result = await upload(image);
  const url = result.body?.user?.avatarUrl;
  try {
    check('khách hàng tải avatar thành công, đường dẫn WEBP tương đối', result.status === 200 && /^\/uploads\/[a-f0-9-]+\.webp$/.test(url || ''));
    const me = await call(user.token, 'GET', '/auth/me');
    check('avatar được lưu và trả lại từ hồ sơ', me.body?.user?.avatarUrl === url && Boolean(url));
    const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
    check('đăng nhập trả lại avatar', (await loginRes.json()).user?.avatarUrl === url && Boolean(url));
    if (url) {
      const res = await fetch(`${new URL(API).origin}${url}`);
      check('ảnh được phục vụ dạng WEBP', res.status === 200 && res.headers.get('content-type')?.includes('image/webp'));
    }
    const removed = await call(user.token, 'DELETE', '/auth/me/avatar');
    check('xoá avatar trở về null', removed.status === 200 && removed.body?.user?.avatarUrl === null);
    check('xoá avatar lần hai vẫn thành công', (await call(user.token, 'DELETE', '/auth/me/avatar')).status === 200);
  } finally {
    if (url && process.env.STORAGE_DRIVER === 'db') {
      await prisma.storedFile.deleteMany({ where: { name: url.split('/').pop() } });
    } else if (url) {
      const path = require('path');
      await require('fs/promises').unlink(path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), path.basename(url))).catch(() => {});
    }
  }
}

async function testChangePassword(user) {
  console.log(`\n${D}2. Đổi mật khẩu và thu hồi token${X}`);
  // Hai phiên: thiết bị đang đổi mật khẩu và "thiết bị khác". Gọi trước một lần
  // để trạng thái tài khoản nằm sẵn trong cache Redis (trường hợp khó nhất).
  const otherDevice = await login(user.email, PASSWORD);
  check('thiết bị khác dùng được trước khi đổi', (await call(otherDevice, 'GET', '/auth/me')).status === 200);

  const wrong = await changePassword(user.token, 'SaiMatKhau999', 'MatKhauMoi12345');
  check('sai mật khẩu hiện tại -> 400 (không phải 401)', wrong.status === 400, `nhận ${wrong.status}`);
  const weak = await changePassword(user.token, PASSWORD, 'ngan');
  check('mật khẩu mới < 8 ký tự -> 400', weak.status === 400, `nhận ${weak.status}`);
  const same = await changePassword(user.token, PASSWORD, PASSWORD);
  check('mật khẩu mới trùng mật khẩu cũ -> 400', same.status === 400, `nhận ${same.status}`);
  const tooLong = await changePassword(user.token, PASSWORD, 'á'.repeat(37));
  check('mật khẩu mới > 72 byte -> 400', tooLong.status === 400, `nhận ${tooLong.status}`);
  check('các lần thất bại không thu hồi token', (await call(user.token, 'GET', '/auth/me')).status === 200);

  const NEW = 'MatKhauMoi12345';
  const ok = await changePassword(user.token, PASSWORD, NEW);
  check('đổi mật khẩu -> 200 kèm token mới', ok.status === 200 && typeof ok.body?.token === 'string');

  const oldOwn = await call(user.token, 'GET', '/auth/me');
  check(
    'token cũ của chính thiết bị -> 403, message có chữ "token"',
    oldOwn.status === 403 && /token/i.test(oldOwn.body?.message ?? ''),
    `${oldOwn.status} ${oldOwn.body?.message}`
  );
  const oldOther = await call(otherDevice, 'GET', '/orders/my-orders');
  check('token của thiết bị khác -> 403 ngay (không chờ cache hết hạn)', oldOther.status === 403, `nhận ${oldOther.status}`);
  check('token mới dùng được', (await call(ok.body.token, 'GET', '/auth/me')).status === 200);

  check('đăng nhập bằng mật khẩu cũ thất bại', (await login(user.email, PASSWORD)) === null);
  const fresh = await login(user.email, NEW);
  check('đăng nhập bằng mật khẩu mới thành công', Boolean(fresh));

  // Token ký đúng secret nhưng thiếu `tv` (cấp trước khi có tính năng) = phiên bản 0.
  const legacy = jwt.sign({ userId: user.id, role: 'CUSTOMER' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const legacyRes = await call(legacy, 'GET', '/auth/me');
  check('token cũ không có tv sau khi đổi mật khẩu -> 403', legacyRes.status === 403, `nhận ${legacyRes.status}`);

  return fresh;
}

async function testConcurrentChange(user) {
  console.log(`\n${D}3. Hai yêu cầu đổi mật khẩu cùng lúc${X}`);
  const results = await Promise.all([
    changePassword(user.token, PASSWORD, 'MatKhauNhanhA111'),
    changePassword(user.token, PASSWORD, 'MatKhauNhanhB222'),
  ]);
  const okCount = results.filter((r) => r.status === 200).length;
  check('chỉ một yêu cầu thành công', okCount === 1, results.map((r) => r.status).join(','));
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  check('tokenVersion chỉ tăng 1', row.tokenVersion === 1, `tokenVersion = ${row.tokenVersion}`);
  const winner = results.find((r) => r.status === 200);
  const winnerPassword = results[0] === winner ? 'MatKhauNhanhA111' : 'MatKhauNhanhB222';
  check('mật khẩu trong DB là của bên thắng', await bcrypt.compare(winnerPassword, row.password));
}

async function testUnauthenticated() {
  console.log(`\n${D}4. Không đăng nhập${X}`);
  const res = await fetch(`${API}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'x', newPassword: 'MatKhauMoi12345' }),
  });
  check('đổi mật khẩu không có token -> 401', res.status === 401, `nhận ${res.status}`);
}

async function main() {
  console.log(`\n${D}Hồ sơ người dùng${X}`);
  const profileUser = await createUser('name');
  await testProfile(profileUser);
  await testAvatar(profileUser);
  await testChangePassword(await createUser('password'));
  await testConcurrentChange(await createUser('race'));
  await testUnauthenticated();
}

main()
  .catch((error) => {
    check('chạy bộ test không gặp lỗi ngoài dự kiến', false, error.message);
    console.error(error);
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } }).catch((error) => {
      check('dọn dữ liệu kiểm thử', false, error.message);
    });
    await prisma.$disconnect();
    console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
