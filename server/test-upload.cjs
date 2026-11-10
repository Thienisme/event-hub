/**
 * Tải ảnh banner: phân quyền, kiểm tra nội dung file, giới hạn dung lượng,
 * header khi phục vụ ảnh, và bannerUrl của sự kiện.
 * Yêu cầu: server đang chạy, cùng DATABASE_URL và cùng thư mục làm việc
 * (để dọn ảnh test trong UPLOAD_DIR) với script này.
 * Dùng: npm run test:upload
 */
require('dotenv').config();
const fs = require('fs');
const http = require('http');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const API = process.env.BASE_URL || 'http://localhost:5000/api';
const ORIGIN = new URL(API).origin;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
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
const password = 'MatKhauDaiHon8KyTu';
const users = [];
const eventIds = [];
const uploadedFiles = [];
const UPLOAD_PATH = /^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// Ảnh PNG 1x1 hợp lệ.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const JPG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

async function createUser(tag, role) {
  const email = `upload-${tag}-${stamp}@test.local`;
  const user = await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 4), fullName: 'Upload', role },
    select: { id: true },
  });
  users.push(user.id);
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await res.json();
  if (!token) throw new Error(`Không đăng nhập được (${res.status})`);
  return token;
}

/** files: [{ field, buf, name, type }] */
async function upload(token, files) {
  const form = new FormData();
  for (const f of files) form.append(f.field, new Blob([f.buf], { type: f.type }), f.name);
  const res = await fetch(`${API}/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (body && typeof body.url === 'string') uploadedFiles.push(path.basename(body.url));
  return { status: res.status, body };
}

const file = (buf, name = 'banner.png', type = 'image/png') => [{ field: 'file', buf, name, type }];

/** Gửi đường dẫn thô, không để fetch chuẩn hoá `..`. */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(ORIGIN);
    const req = http.request({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function createEvent(token, bannerUrl) {
  const res = await fetch(`${API}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'UPLOAD TEST',
      location: 'HN',
      bannerUrl,
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 90_000_000).toISOString(),
      ticketTypes: [{ name: 'A', price: 1000, totalQuantity: 1 }],
    }),
  });
  const body = await res.json().catch(() => null);
  if (body && body.event) eventIds.push(body.event.id);
  return { status: res.status, body };
}

async function testPermissions(customer) {
  console.log(`\n${D}Phân quyền${X}`);
  const anon = await upload(null, file(PNG));
  check('không có token -> 401', anon.status === 401, `nhận ${anon.status}`);
  const cust = await upload(customer, file(PNG));
  check('CUSTOMER -> 403', cust.status === 403, `nhận ${cust.status}`);
}

async function testValidUpload(organizer) {
  console.log(`\n${D}Tải ảnh hợp lệ${X}`);
  const res = await upload(organizer, file(PNG));
  check('PNG hợp lệ -> 201', res.status === 201, `nhận ${res.status} ${JSON.stringify(res.body)}`);
  const url = res.body && res.body.url;
  check('url là đường dẫn tương đối /uploads/<uuid>.png', UPLOAD_PATH.test(url || '') && url.endsWith('.png'), url);

  const jpg = await upload(organizer, file(JPG_HEADER, 'a.jpg', 'image/jpeg'));
  check('JPG -> 201, đuôi .jpg', jpg.status === 201 && /\.jpg$/.test(jpg.body.url), `nhận ${jpg.status}`);
  const webp = await upload(organizer, file(WEBP_HEADER, 'a.webp', 'image/webp'));
  check('WEBP -> 201, đuôi .webp', webp.status === 201 && /\.webp$/.test(webp.body.url), `nhận ${webp.status}`);

  // Đuôi file theo NỘI DUNG, không theo tên client gửi.
  const misnamed = await upload(organizer, file(PNG, 'anh.jpg', 'image/jpeg'));
  check('PNG đặt tên .jpg -> lưu thành .png', misnamed.status === 201 && /\.png$/.test(misnamed.body.url), misnamed.body && misnamed.body.url);

  if (!url) return null;
  const served = await fetch(`${ORIGIN}${url}`);
  const bytes = Buffer.from(await served.arrayBuffer());
  check('GET ảnh -> 200, đúng nội dung', served.status === 200 && bytes.equals(PNG), `nhận ${served.status}`);
  check('Content-Type image/png', served.headers.get('content-type') === 'image/png', served.headers.get('content-type'));
  check(
    'Cross-Origin-Resource-Policy: cross-origin (client khác cổng vẫn hiện ảnh)',
    served.headers.get('cross-origin-resource-policy') === 'cross-origin',
    served.headers.get('cross-origin-resource-policy')
  );
  check('X-Content-Type-Options: nosniff', served.headers.get('x-content-type-options') === 'nosniff');
  check(
    'CSP chặn script khi mở ảnh trực tiếp',
    /default-src 'none'/.test(served.headers.get('content-security-policy') || ''),
    served.headers.get('content-security-policy')
  );
  return url;
}

async function testRejected(organizer) {
  console.log(`\n${D}Từ chối file không hợp lệ${X}`);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const fake = await upload(organizer, file(html, 'xss.png', 'image/png'));
  check('HTML giả làm PNG -> 400', fake.status === 400, `nhận ${fake.status} "${fake.body && fake.body.message}"`);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgRes = await upload(organizer, file(svg, 'a.svg', 'image/svg+xml'));
  check('SVG -> 400 (có thể chứa script)', svgRes.status === 400, `nhận ${svgRes.status}`);

  const empty = await upload(organizer, file(Buffer.alloc(0)));
  check('file rỗng -> 400', empty.status === 400, `nhận ${empty.status}`);

  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const tooBig = await upload(organizer, file(big));
  check(
    'ảnh > 5MB -> 413 kèm message JSON',
    tooBig.status === 413 && tooBig.body && /5MB/.test(tooBig.body.message),
    `nhận ${tooBig.status} ${JSON.stringify(tooBig.body)}`
  );

  const noFile = await upload(organizer, []);
  check('không gửi file -> 400', noFile.status === 400, `nhận ${noFile.status}`);

  const wrongField = await upload(organizer, [{ field: 'image', buf: PNG, name: 'a.png', type: 'image/png' }]);
  check('sai tên trường -> 400', wrongField.status === 400, `nhận ${wrongField.status}`);

  const two = await upload(organizer, [...file(PNG), ...file(PNG)]);
  check('gửi 2 file -> 400', two.status === 400, `nhận ${two.status}`);

  const traversal = await rawGet('/uploads/..%2f.env');
  const traversal2 = await rawGet('/uploads/../.env');
  check(
    'không đọc được file ngoài thư mục upload',
    traversal.status !== 200 && traversal2.status !== 200 && !/JWT_SECRET/.test(traversal.body + traversal2.body),
    `nhận ${traversal.status}, ${traversal2.status}`
  );
}

async function testBannerUrl(organizer, uploadedUrl) {
  console.log(`\n${D}bannerUrl của sự kiện${X}`);
  if (uploadedUrl) {
    const ok = await createEvent(organizer, uploadedUrl);
    check(
      'bannerUrl = ảnh vừa tải -> 201, lưu nguyên đường dẫn',
      ok.status === 201 && ok.body.event.bannerUrl === uploadedUrl,
      `nhận ${ok.status} ${ok.body && ok.body.message}`
    );
  }
  const ext = await createEvent(organizer, 'https://images.example.com/a.jpg');
  check('URL https bên ngoài -> 201', ext.status === 201, `nhận ${ext.status}`);
  const none = await createEvent(organizer, null);
  check('bannerUrl null -> 201', none.status === 201, `nhận ${none.status}`);

  for (const bad of [
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '/uploads/../.env',
    '/uploads/abc.png',
    '/etc/passwd',
    'ftp://a.com/a.png',
  ]) {
    const res = await createEvent(organizer, bad);
    check(`bannerUrl "${bad}" -> 400`, res.status === 400, `nhận ${res.status}`);
  }
}

async function cleanup() {
  for (const id of eventIds) await prisma.event.delete({ where: { id } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
  for (const name of uploadedFiles) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
}

async function main() {
  console.log(`\n${D}Tải ảnh banner${X}`);
  const organizer = await createUser('organizer', 'ORGANIZER');
  const customer = await createUser('customer', 'CUSTOMER');

  await testPermissions(customer);
  const url = await testValidUpload(organizer);
  await testRejected(organizer);
  await testBannerUrl(organizer, url);

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
