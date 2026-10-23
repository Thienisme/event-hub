/**
 * Chạy toàn bộ bộ test server theo thứ tự, tự chờ hết cửa sổ rate limit.
 *
 * Vì sao cần script này:
 *
 * `apiRateLimiter` giới hạn 100 request/phút cho mọi API. Mỗi bộ test riêng lẻ
 * dùng chưa tới 40 request nên chạy thoải mái — nhưng chạy CẢ 7 bộ liên tiếp
 * trong một lần thì tổng vượt 100, và các test sau nhận 429. Triệu chứng rất dễ
 * hiểu nhầm: script CORS báo "không kết nối được server", script validation báo
 * "Unexpected token 'Q' ... is not valid JSON" — trong khi thực tế server vẫn
 * chạy tốt, chỉ là bị chặn tạm.
 *
 * Thay vì ngủ cứng 60 giây, script này đọc header `RateLimit-Remaining` và
 * `RateLimit-Reset` (server bật `standardHeaders: true`) để chờ đúng số giây
 * còn thiếu. Hết hạn sớm thì chạy tiếp ngay.
 *
 * Dùng: node run-all-tests.cjs
 */
const { spawn } = require('child_process');

const API = 'http://localhost:5000/api';

// Thứ tự: test rẻ và nhanh trước, test nặng (race, load) sau.
const SUITES = [
  ['test:security', 'test-jwt-security.cjs'],
  ['test:race', 'test-admin-race.cjs'],
  ['test:limits', 'test-event-limits.cjs'],
  ['test:errors', 'test-error-mapping.cjs'],
  ['test:order', 'test-order-amount.cjs'],
  ['test:validation', 'test-validation.cjs'],
  ['test:cors', 'test-cors.cjs'],
];

const G = '\u001b[32m';
const R = '\u001b[31m';
const D = '\u001b[2m';
const X = '\u001b[0m';

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Hỏi server còn bao nhiêu hạn mức request, và cửa sổ reset sau bao lâu. */
async function rateLimitState() {
  try {
    const res = await fetch(`${API}/health`);
    const remaining = Number(res.headers.get('ratelimit-remaining'));
    const reset = Number(res.headers.get('ratelimit-reset'));
    if (Number.isNaN(remaining) || Number.isNaN(reset)) return null;
    return { remaining, reset };
  } catch {
    return null;
  }
}

/** Chờ tới khi server reset hạn mức (hoặc hết giờ chờ tối đa). */
async function waitForQuota() {
  const state = await rateLimitState();
  if (!state) return;

  if (state.remaining > 0) return;

  // `RateLimit-Reset` là số giây còn lại của cửa sổ hiện tại.
  const waitMs = Math.min(Math.max(state.reset, 1), 70) * 1000;
  console.log(
    `${D}   hạn mức đã hết, chờ ${Math.round(waitMs / 1000)}s cho cửa sổ rate limit reset...${X}`
  );
  await new Promise((r) => setTimeout(r, waitMs));
}

async function main() {
  console.log(`\n${D}=== Chạy toàn bộ bộ test server ===${X}\n`);

  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health) {
    console.log(
      `${R}Không kết nối được ${API}/health. Hãy chạy "npm run dev" ở thư mục server trước.${X}`
    );
    process.exit(1);
  }

  const failed = [];

  for (const [name, script] of SUITES) {
    console.log(`\n${D}──────── ${name} ────────${X}`);
    const code = await run(script);
    if (code !== 0) failed.push(name);
    await waitForQuota();
  }

  console.log(`\n${D}======== Kết quả tổng ========${X}`);
  if (failed.length === 0) {
    console.log(`${G}✅ Tất cả ${SUITES.length} bộ test đều PASS${X}`);
    process.exit(0);
  }

  console.log(`${R}❌ FAIL: ${failed.join(', ')}${X}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
