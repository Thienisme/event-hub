/**
 * Test CORS — whitelist origin.
 *
 * Vì sao cần test riêng: bug "toán tử comma" trong `app.ts` đã khiến toàn bộ
 * origin ngoài `localhost:5175` bị chặn, kể cả origin hợp lệ khai trong
 * `CORS_ORIGINS`. Bug đó lọt qua mọi test cũ vì các script test gọi API bằng
 * `fetch` của Node — Node KHÔNG tự gửi header `Origin`, nên nhánh "không có
 * Origin -> cho qua" luôn đúng và whitelist chưa bao giờ được kiểm tra.
 *
 * Test này gửi header `Origin` thật (giống trình duyệt) và kiểm tra header
 * `Access-Control-Allow-Origin` trả về.
 *
 *   1. Unit: `parseAllowedOrigins` — mặc định phải có ĐỦ cổng, env phải thắng.
 *   2. Integration: server đang chạy phải trả CORS header cho các origin hợp lệ.
 *   3. Integration: server chạy với `CORS_ORIGINS` riêng phải CHỈ cho phép
 *      origin đó (dựng thêm một instance trên cổng riêng).
 */
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

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

/**
 * Gọi API kèm header Origin, trả về header Access-Control-Allow-Origin.
 *
 * Dùng `GET /api/health` chứ không phải `POST /api/auth/login`:
 * middleware CORS được đăng ký GLOBAL (`app.use(cors(...))`) nên hành vi header
 * y hệt ở mọi endpoint — nhưng login sai mật khẩu sẽ bị `authRateLimiter`
 * (5 lần thất bại/phút) tính vào hạn mức và chặn cả những test khác chạy sau.
 * `/api/health` là endpoint public, không dính limiter nào ngoài `apiRateLimiter`.
 */
async function allowOriginFor(origin, api = API) {
  const res = await fetch(`${api}/health`, {
    headers: origin ? { Origin: origin } : {},
  });
  return res.headers.get('access-control-allow-origin');
}

async function main() {
  console.log(`\n${D}Test CORS — whitelist origin${X}`);

  // ---------------------------------------------------------------- 1. UNIT
  console.log(`\n${D}[1] Unit — parseAllowedOrigins${X}`);

  // Nạp trực tiếp file TS bằng ts-node (không cần build). Dùng đúng
  // compilerOptions của project — ghi đè `module` một cách tùy tiện sẽ xung đột
  // với `moduleResolution: NodeNext` và ts-node báo lỗi TS5110.
  require('ts-node').register({ transpileOnly: true });
  const { parseAllowedOrigins, DEFAULT_CORS_ORIGINS } = require('./src/utils/cors');

  const defaults = parseAllowedOrigins(undefined);
  check(
    'mặc định có đủ cổng 5173-5176 (không rơi còn 1 cổng)',
    ['5173', '5174', '5175', '5176'].every((p) =>
      defaults.includes(`http://localhost:${p}`)
    ),
    `có ${defaults.length} origin`
  );
  check(
    'mặc định có cả 127.0.0.1 (localhost và 127.0.0.1 là 2 origin khác nhau)',
    ['5173', '5174', '5175', '5176'].every((p) => defaults.includes(`http://127.0.0.1:${p}`))
  );
  check(
    'mặc định khớp với DEFAULT_CORS_ORIGINS khai báo',
    defaults.length === DEFAULT_CORS_ORIGINS.length &&
      defaults.every((o) => DEFAULT_CORS_ORIGINS.includes(o)),
    `${defaults.length} vs ${DEFAULT_CORS_ORIGINS.length}`
  );

  // ★ Chống hồi quy của bug toán tử comma: nếu ai đó viết lại
  // `raw ?? 'a', 'b'` thì hàm này phải không còn trả về danh sách đầy đủ.
  const fromEnv = parseAllowedOrigins('http://a.test,http://b.test');
  check(
    'CORS_ORIGINS từ env được dùng đúng (không bị toán tử comma nuốt mất)',
    fromEnv.length === 2 && fromEnv[0] === 'http://a.test' && fromEnv[1] === 'http://b.test',
    JSON.stringify(fromEnv)
  );
  check(
    'env rỗng -> dùng danh sách mặc định',
    parseAllowedOrigins('').length === DEFAULT_CORS_ORIGINS.length
  );
  check(
    'env có khoảng trắng thừa -> được trim',
    JSON.stringify(parseAllowedOrigins(' http://a.test , http://b.test ')) ===
      JSON.stringify(['http://a.test', 'http://b.test'])
  );

  // -------------------------------------------------------- 2. INTEGRATION
  console.log(`\n${D}[2] Integration — server đang chạy${X}`);

  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health || !health.ok) {
    check('server đang chạy ở cổng 5000', false, 'không kết nối được — hãy chạy npm run dev');
  } else {
    check('server đang chạy ở cổng 5000', true);

    for (const port of [5173, 5174, 5175, 5176]) {
      const origin = `http://localhost:${port}`;
      const allow = await allowOriginFor(origin);
      check(
        `origin ${origin} được phép -> có header Access-Control-Allow-Origin`,
        allow === origin,
        allow ? `trả về "${allow}"` : 'KHÔNG có header (bị chặn)'
      );
    }

    const allow127 = await allowOriginFor('http://127.0.0.1:5174');
    check(
      'origin http://127.0.0.1:5174 được phép',
      allow127 === 'http://127.0.0.1:5174',
      allow127 ? `trả về "${allow127}"` : 'KHÔNG có header'
    );

    const evil = await allowOriginFor('http://evil.example.com');
    check(
      'origin lạ KHÔNG được header CORS (trình duyệt tự chặn)',
      evil === null,
      evil ? `SAI — trả về "${evil}"` : 'đúng, không có header'
    );

    const noOrigin = await allowOriginFor(null);
    check(
      'không có header Origin (curl/k6) -> vẫn gọi được API',
      noOrigin === null,
      'API trả lời bình thường, không bị chặn CORS'
    );

    // ★ Luồng thật của người dùng: đăng nhập thành công từ origin hợp lệ phải
    // vừa có header CORS vừa trả token. Login THÀNH CÔNG không bị
    // `authRateLimiter` tính vào hạn mức (chỉ login thất bại mới bị đếm).
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'admin12345' }),
    });
    const loginBody = await loginRes.json().catch(() => null);
    check(
      'đăng nhập thật từ origin hợp lệ -> 200 + header CORS + token',
      loginRes.status === 200 &&
        loginRes.headers.get('access-control-allow-origin') === 'http://localhost:5174' &&
        !!(loginBody && loginBody.token),
      `nhận ${loginRes.status}, allow-origin: "${loginRes.headers.get('access-control-allow-origin') || 'không có'}"`
    );

    // Preflight OPTIONS: trình duyệt gửi trước khi POST/PUT.
    const preflight = await fetch(`${API}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    check(
      'preflight OPTIONS -> 204 kèm Access-Control-Allow-Methods',
      preflight.status === 204 && !!preflight.headers.get('access-control-allow-methods'),
      `nhận ${preflight.status}, allow-methods: "${preflight.headers.get('access-control-allow-methods') || 'không có'}"`
    );
  }

  // --------------------------------- 3. INTEGRATION với CORS_ORIGINS riêng
  console.log(`\n${D}[3] Integration — CORS_ORIGINS từ env ghi đè mặc định${X}`);

  const customPort = 5099;
  const customOrigin = 'http://my-frontend.test';
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'src/app.ts')],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(customPort),
        CORS_ORIGINS: customOrigin,
      },
      stdio: 'ignore',
    }
  );

  const customApi = `http://localhost:${customPort}/api`;
  try {
    // Chờ server lên (tối đa 20s).
    let up = false;
    for (let i = 0; i < 40; i += 1) {
      const res = await fetch(`${customApi}/health`).catch(() => null);
      if (res && res.ok) {
        up = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!up) {
      check('dựng được server thứ hai với CORS_ORIGINS riêng', false, 'timeout 20s');
    } else {
      check('dựng được server thứ hai với CORS_ORIGINS riêng', true);

      const customAllow = await allowOriginFor(customOrigin, customApi);
      check(
        `origin "${customOrigin}" trong env -> được phép`,
        customAllow === customOrigin,
        customAllow ? `trả về "${customAllow}"` : 'KHÔNG có header'
      );

      const defaultBlocked = await allowOriginFor('http://localhost:5174', customApi);
      check(
        'origin mặc định KHÔNG còn được phép khi env đã ghi đè',
        defaultBlocked === null,
        defaultBlocked ? `SAI — trả về "${defaultBlocked}"` : 'đúng, không có header'
      );
    }
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
