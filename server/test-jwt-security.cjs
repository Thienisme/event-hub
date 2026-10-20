/**
 * Test bảo mật JWT cho EventHub.
 *
 * Chứng minh 2 điều:
 *   A. Server TỪ CHỐI khởi động khi JWT_SECRET thiếu / quá ngắn / là giá trị mặc
 *      định cũ đã bị lộ trong source.
 *   B. Token giả mạo bị API TỪ CHỐI (mọi kiểu giả mạo thường gặp).
 *
 * Chạy:      node test-jwt-security.cjs
 * Yêu cầu:   server đang chạy (mặc định http://localhost:5000, override bằng BASE_URL)
 *            và .env có JWT_SECRET (phần A không cần server).
 *
 * Không dùng framework test nào (vitest/jest/supertest): dự án chưa có, và thêm
 * một framework chỉ để chạy 1 file là quá tay. Node 22 đã có sẵn fetch + spawnSync.
 */
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const jwt = require('jsonwebtoken');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000/api';
const SECRET = process.env.JWT_SECRET;

// Endpoint yêu cầu đăng nhập nhưng KHÔNG cần user có thật trong DB: nó chỉ lọc
// đơn theo userId, nên token hợp lệ + userId không tồn tại -> 200 với mảng rỗng.
// Nhờ vậy test được chữ ký mà không cần credential nào.
const AUTH_ONLY_PATH = '/orders/my-orders';

// Endpoint chỉ ORGANIZER/ADMIN được gọi -> dùng để test phân quyền.
const ROLE_ONLY_PATH = '/events';

// Secret mặc định cũ, đã nằm trong lịch sử git -> coi như công khai.
const LEAKED_SECRET = 'supersecret_eventhub_key';

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000000';

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

// ---------------------------------------------------------------------------
// Tiện ích tạo token
// ---------------------------------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

const signWith = (secret, payload, options) =>
  jwt.sign(payload, secret, options || { algorithm: 'HS256' });

/** Token `alg: none` — ghép tay, vì thư viện chặn khi tạo. */
const algNoneToken = (payload) =>
  `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;

/** Token hợp lệ về hình thức cho một user bất kỳ. */
const tokenFor = (userId, role) =>
  signWith(SECRET, {
    userId,
    role: role || 'CUSTOMER',
    iat: nowSec(),
    exp: nowSec() + 3600,
  });

async function request(pathname, opts) {
  const options = opts || {};
  const headers = {};

  // `token: null` = cố tình KHÔNG gửi header Authorization
  if (options.token !== null && options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.rawAuthHeader !== undefined) {
    headers.Authorization = options.rawAuthHeader;
  }
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* response không phải JSON */
  }

  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Tiện ích: user thật + Prisma
// ---------------------------------------------------------------------------

/**
 * Tạo một user CUSTOMER CÓ THẬT trong DB (qua API đăng ký).
 *
 * Cần user thật vì `authorize` đọc role từ DB chứ không tin token: user giả sẽ
 * bị chặn ở bước "không tìm thấy tài khoản" chứ không tới bước kiểm tra role.
 */
async function createRealCustomer() {
  const email = `jwt-sec-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const res = await request('/auth/register', {
    method: 'POST',
    body: { email, password: 'MatKhauDaiHon8KyTu', fullName: 'JWT Security Test' },
  });

  if (!res.body || !res.body.user || !res.body.user.id) {
    throw new Error(`Không tạo được user test: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.user;
}

/** Mở kết nối Prisma (nạp động để file này vẫn chạy được khi thiếu DB). */
async function getPrisma() {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient();
}

/**
 * Xoá cache trạng thái tài khoản trong Redis.
 *
 * Server cache role/isActive của user trong Redis (TTL 30s) để đường nóng không
 * phải đọc DB. Khi test sửa DB trực tiếp thì phải xoá cache đi, đúng như
 * `invalidateUserState` mà admin API gọi khi đổi role / khoá tài khoản.
 */
async function invalidateUserStateCache(userId) {
  const Redis = require('ioredis');
  const client = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
  });
  try {
    await client.del(`user:state:${userId}`);
  } finally {
    await client.quit();
  }
}

// ---------------------------------------------------------------------------
// Phần A — kiểm tra cấu hình (chạy getJwtSecret() trong process riêng)
// ---------------------------------------------------------------------------

const PROBE_SOURCE = `
const { getJwtSecret } = require('./src/config/auth');
try {
  getJwtSecret();
  process.stdout.write(JSON.stringify({ threw: false }));
} catch (error) {
  process.stdout.write(JSON.stringify({ threw: true, message: error.message.split('\\n')[0] }));
}
`;

/**
 * Chạy getJwtSecret() trong một process con với JWT_SECRET cho trước.
 * `value === undefined` nghĩa là xoá hẳn biến môi trường.
 */
function probeSecret(value) {
  const env = { ...process.env };

  // Trỏ dotenv sang file KHÔNG tồn tại để .env không được nạp. Nếu bỏ bước này,
  // `import 'dotenv/config'` trong config/auth.ts sẽ nạp .env và "hồi sinh"
  // JWT_SECRET — test sẽ luôn thấy secret hợp lệ và không kiểm tra được gì.
  env.DOTENV_CONFIG_PATH = path.join(__dirname, 'khong-ton-tai.env');

  if (value === undefined) delete env.JWT_SECRET;
  else env.JWT_SECRET = value;

  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-e', PROBE_SOURCE],
    { cwd: __dirname, env, encoding: 'utf8' }
  );

  try {
    return JSON.parse((result.stdout || '').trim());
  } catch {
    return {
      threw: false,
      message: `không chạy được probe: ${(result.stderr || '').split('\n')[0]}`,
    };
  }
}

function runConfigTests() {
  console.log(`\n${D}Phần A — cấu hình JWT_SECRET (không cần server)${X}`);

  const missing = probeSecret(undefined);
  check('thiếu JWT_SECRET -> getJwtSecret() ném lỗi', missing.threw, missing.message);

  const leaked = probeSecret(LEAKED_SECRET);
  check('JWT_SECRET là giá trị mặc định cũ -> ném lỗi', leaked.threw, leaked.message);

  const short = probeSecret('abc123');
  check('JWT_SECRET quá ngắn -> ném lỗi', short.threw, short.message);

  const strong = probeSecret('a'.repeat(64));
  check('JWT_SECRET mạnh (64 ký tự) -> chấp nhận', strong.threw === false);
}

// ---------------------------------------------------------------------------
// Phần B — API từ chối token giả mạo
// ---------------------------------------------------------------------------

async function runTokenTests() {
  console.log(`\n${D}Phần B — API từ chối token giả mạo${X}`);

  // 1. Không có header
  const noHeader = await request(AUTH_ONLY_PATH, { token: null });
  check('không gửi Authorization -> 401', noHeader.status === 401, `nhận ${noHeader.status}`);

  // 2. Sai định dạng header
  const badFormat = await request(AUTH_ONLY_PATH, { rawAuthHeader: 'khong-co-tien-to' });
  check('header sai định dạng -> 401', badFormat.status === 401, `nhận ${badFormat.status}`);

  // 3. ★ Token ký bằng secret đã lộ trong source — đây là lỗ hổng đã vá
  const leakedToken = signWith(LEAKED_SECRET, {
    userId: FAKE_USER_ID,
    role: 'ADMIN',
    iat: nowSec(),
    exp: nowSec() + 3600,
  });
  const leaked = await request(AUTH_ONLY_PATH, { token: leakedToken });
  check(
    'token ký bằng secret cũ đã lộ -> 403',
    leaked.status === 403,
    `nhận ${leaked.status}`
  );

  // 4. Token ký bằng secret khác
  const wrongToken = signWith('mot-secret-hoan-toan-khac-nhung-du-dai-de-qua-buoc-do-dai-kiem-tra-xx', {
    userId: FAKE_USER_ID,
    role: 'ADMIN',
    iat: nowSec(),
    exp: nowSec() + 3600,
  });
  const wrong = await request(AUTH_ONLY_PATH, { token: wrongToken });
  check('token ký bằng secret khác -> 403', wrong.status === 403, `nhận ${wrong.status}`);

  // 5. alg: none (algorithm confusion)
  const noneToken = algNoneToken({
    userId: FAKE_USER_ID,
    role: 'ADMIN',
    iat: nowSec(),
    exp: nowSec() + 3600,
  });
  const none = await request(AUTH_ONLY_PATH, { token: noneToken });
  check('token alg:none -> 403', none.status === 403, `nhận ${none.status}`);

  // 6. Token hết hạn (ký bằng secret ĐÚNG)
  const expired = await request(AUTH_ONLY_PATH, {
    token: signWith(SECRET, {
      userId: FAKE_USER_ID,
      role: 'CUSTOMER',
      iat: nowSec() - 7200,
      exp: nowSec() - 3600,
    }),
  });
  check('token hết hạn -> 403', expired.status === 403, `nhận ${expired.status}`);

  // 7. Payload bị sửa nhưng giữ chữ ký cũ (leo thang đặc quyền)
  const valid = tokenFor(FAKE_USER_ID, 'CUSTOMER');
  const [headerPart, payloadPart, signaturePart] = valid.split('.');
  const tamperedPayload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
  tamperedPayload.role = 'ADMIN';
  const tampered = `${headerPart}.${b64url(tamperedPayload)}.${signaturePart}`;
  const tamperedRes = await request(AUTH_ONLY_PATH, { token: tampered });
  check(
    'sửa role trong payload (giữ chữ ký cũ) -> 403',
    tamperedRes.status === 403,
    `nhận ${tamperedRes.status}`
  );

  // 8. Token hợp lệ -> phải ĐƯỢC CHẤP NHẬN (nếu không thì các test trên vô nghĩa)
  //
  //    Phải là user CÓ THẬT: middleware `authenticate` hỏi DB xem tài khoản còn
  //    tồn tại và còn hoạt động không, nên token của user không có trong DB sẽ bị
  //    401. Đó là hành vi đúng — token của tài khoản đã bị xoá không được dùng.
  const realUser = await createRealCustomer();
  const realToken = tokenFor(realUser.id, 'CUSTOMER');

  const validRes = await request(AUTH_ONLY_PATH, { token: realToken });
  check(
    'token hợp lệ -> 200 (chứng minh 403 ở trên là do chữ ký, không phải chặn hết)',
    validRes.status === 200 && Array.isArray(validRes.body),
    `nhận ${validRes.status}`
  );

  // 9. Phân quyền vẫn chạy: role CUSTOMER gọi endpoint chỉ ORGANIZER/ADMIN
  //    Gửi body rỗng để nếu authorize CÓ lỗi thì createEvent trả 400 (validate),
  //    chứ không tạo ra sự kiện rác.
  //
  //    Role được đọc từ DB chứ không tin token, nên role CUSTOMER trong token của
  //    user thật vẫn bị chặn đúng như mong đợi.
  const forbidden = await request(ROLE_ONLY_PATH, {
    token: realToken,
    method: 'POST',
    body: {},
  });
  check(
    'role CUSTOMER gọi endpoint ORGANIZER/ADMIN -> 403 (phân quyền, không phải lỗi token)',
    forbidden.status === 403 && /quyền/i.test((forbidden.body || {}).message || ''),
    `nhận ${forbidden.status} — "${(forbidden.body || {}).message}"`
  );

  // 9b. ★ Token hợp lệ nhưng tài khoản KHÔNG tồn tại -> 401
  const ghost = await request(AUTH_ONLY_PATH, { token: valid });
  check(
    'token hợp lệ nhưng tài khoản không tồn tại -> 401',
    ghost.status === 401,
    `nhận ${ghost.status}`
  );

  // 10. ★ Tài khoản bị khoá -> token còn hạn vẫn mất quyền ngay lập tức
  const prisma = await getPrisma();
  await prisma.user.update({
    where: { id: realUser.id },
    data: { isActive: false },
  });
  await invalidateUserStateCache(realUser.id);

  const locked = await request(ROLE_ONLY_PATH, {
    token: realToken,
    method: 'POST',
    body: {},
  });
  check(
    'tài khoản bị khoá -> 403 dù token còn hạn',
    locked.status === 403 && /khoá/i.test((locked.body || {}).message || ''),
    `nhận ${locked.status} — "${(locked.body || {}).message}"`
  );

  // 10b. ★ Tài khoản bị khoá cũng mất quyền trên endpoint CHỈ cần đăng nhập
  //      (đặt vé, xem đơn) — không chỉ endpoint có kiểm tra role.
  const lockedAuthOnly = await request(AUTH_ONLY_PATH, { token: realToken });
  check(
    'tài khoản bị khoá -> 403 cả với endpoint chỉ cần đăng nhập',
    lockedAuthOnly.status === 403 && /khoá/i.test((lockedAuthOnly.body || {}).message || ''),
    `nhận ${lockedAuthOnly.status} — "${(lockedAuthOnly.body || {}).message}"`
  );

  await prisma.user.update({
    where: { id: realUser.id },
    data: { isActive: true },
  });
  await invalidateUserStateCache(realUser.id);

  // 11. ★ Role trong DB là nguồn sự thật, không phải role trong token
  //     Token vẫn mang role CUSTOMER, nhưng DB đã đổi thành ORGANIZER -> phải
  //     QUA được bước authorize (nếu không sẽ là 403 "không có quyền"; qua
  //     được thì rơi xuống validateBody và trả 400 vì body rỗng).
  await prisma.user.update({
    where: { id: realUser.id },
    data: { role: 'ORGANIZER', roleChangedAt: new Date() },
  });
  await invalidateUserStateCache(realUser.id);

  const afterRoleChange = await request(ROLE_ONLY_PATH, {
    token: realToken,
    method: 'POST',
    body: {},
  });
  check(
    'đổi role trong DB -> token cũ lập tức nhận quyền mới (role trong token bị bỏ qua)',
    // 400 = đã qua bước authorize, rơi xuống validateBody và báo thiếu trường.
    // Nếu role trong token vẫn được tin thì kết quả sẽ là 403 "không có quyền".
    // Vì vậy phải khẳng định là 400 VÀ message KHÔNG phải lỗi phân quyền.
    afterRoleChange.status === 400 && !/quyền/i.test((afterRoleChange.body || {}).message || ''),
    `nhận ${afterRoleChange.status} — "${(afterRoleChange.body || {}).message}"`
  );

  // Dọn dẹp: xoá user test, trả DB về trạng thái ban đầu.
  await invalidateUserStateCache(realUser.id);
  await prisma.user.delete({ where: { id: realUser.id } }).catch(() => {});
  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n\u001b[1m=== TEST BẢO MẬT JWT — EventHub ===\u001b[0m');

  runConfigTests();

  if (!SECRET) {
    console.log(
      `\n${R}Không đọc được JWT_SECRET từ .env — bỏ qua phần B.${X}\n` +
        'Thêm vào .env một dòng:\n' +
        '  JWT_SECRET="$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")"\n'
    );
    process.exit(1);
  }

  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (error) {
    console.log(
      `\n${R}Không kết nối được ${BASE_URL}/health (${error.message}).${X}\n` +
        'Hãy chạy server trước (npm run dev), hoặc đặt BASE_URL trỏ tới server khác.\n'
    );
    process.exit(1);
  }

  await runTokenTests();

  console.log(
    `\n\u001b[1mKết quả: ${passed} passed, ${failed} failed\u001b[0m\n`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
