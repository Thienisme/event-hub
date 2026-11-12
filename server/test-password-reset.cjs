/** Kiểm thử tích hợp với DB tạm và MAIL_DRIVER=log; server dùng chung MAIL_OUTBOX_DIR. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const outbox = process.env.MAIL_OUTBOX_DIR;
const users = [];
const stamp = `${Date.now()}-${process.pid}`;
const password = 'MatKhauBanDau123';

async function call(endpoint, body, token) {
  const response = await fetch(`${API}/auth/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
// Server gửi thư ở nền (không chờ), nên chờ tối đa 5 giây cho file thư xuất hiện.
async function mailToken(email, pathname) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await findMailToken(email, pathname); }
    catch (error) { if (attempt === 49) throw error; await new Promise(r => setTimeout(r, 100)); }
  }
}
async function findMailToken(email, pathname) {
  for (const filename of await fs.readdir(outbox)) {
    if (!filename.endsWith('.json')) continue;
    const fullPath = path.join(outbox, filename);
    const mail = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    if (mail.to !== email || !mail.text.includes(pathname)) continue;
    const link = mail.text.match(/https?:\/\/\S+/)?.[0];
    const token = new URL(link).searchParams.get('token');
    assert.ok(token, 'Email phải chứa token');
    return token;
  }
  assert.fail(`Không thấy email ${pathname}`);
}
async function register(tag) {
  const email = `email-${tag}-${stamp}@test.local`;
  const result = await call('register', { email, password, fullName: '<Tên kiểm thử>' });
  if (result.body.user?.id) users.push(result.body.user.id);
  assert.equal(result.status, 201);
  const login = await call('login', { email, password });
  assert.equal(login.status, 200);
  return { email, id: result.body.user.id, jwt: login.body.token };
}
async function main() {
  assert.ok(outbox, 'Cần MAIL_OUTBOX_DIR dùng chung với server');
  const user = await register('reset');
  const missingEmail = `missing-${stamp}@test.local`;
  const missing = await call('forgot-password', { email: missingEmail });
  const existing = await call('forgot-password', { email: user.email });
  assert.equal(missing.status, 200);
  assert.equal(existing.status, 200);
  assert.deepEqual(missing.body, existing.body, 'Không được lộ email tồn tại');
  const token = await mailToken(user.email, '/reset-password');
  const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.notEqual(stored.tokenHash, token);
  assert.equal(stored.tokenHash.length, 64);
  assert.equal((await call('me', undefined, user.jwt)).status, 200);
  assert.equal((await call('reset-password', { token, newPassword: 'ngan' })).status, 400);
  const reset = await call('reset-password', { token, newPassword: 'MatKhauMoi12345' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.token, undefined);
  assert.equal((await call('reset-password', { token, newPassword: 'MatKhauLanHai123' })).status, 400);
  assert.equal((await call('me', undefined, user.jwt)).status, 403);
  assert.equal((await call('login', { email: user.email, password: 'MatKhauMoi12345' })).status, 200);
  console.log('PASS: quên mật khẩu, dùng một lần, mật khẩu mới và thu hồi JWT');

  const verifyToken = await mailToken(user.email, '/verify-email');
  assert.equal((await call('verify-email', { token: verifyToken })).status, 200);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
  assert.equal((await call('verify-email', { token: verifyToken })).status, 400);
  console.log('PASS: xác minh email và từ chối token đã dùng');

  const racer = await register('race');
  assert.equal((await call('forgot-password', { email: racer.email })).status, 200);
  const raceToken = await mailToken(racer.email, '/reset-password');
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    call('reset-password', { token: raceToken, newPassword: 'MatKhauRaceMoi123' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 400).length, 9);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: racer.id } })).tokenVersion, 1);
  console.log('PASS: 10 request đồng thời chỉ một request thành công');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Xoá cả thư xác minh chưa dùng của tài khoản kiểm thử.
  if (outbox) {
    for (const file of await fs.readdir(outbox).catch(() => [])) {
      const fullPath = path.join(outbox, file);
      const mail = await fs.readFile(fullPath, 'utf8').then(JSON.parse).catch(() => null);
      if (mail?.to?.includes(stamp)) await fs.unlink(fullPath);
    }
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
