/** k6 run -e EVENT_ID=... -e TOKENS='["token1","token2"]' load-test-queue.js */
import http from 'k6/http';
import { check, sleep } from 'k6';
const base = (__ENV.BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const tokens = JSON.parse(__ENV.TOKENS || '[]');
if (!__ENV.EVENT_ID || !tokens.length) throw new Error('Cần EVENT_ID và TOKENS (mảng JSON, mỗi VU một token riêng)');
export const options = {
  vus: tokens.length,
  duration: __ENV.DURATION || '1m',
  thresholds: { http_req_duration: ['p(95)<1000'], http_req_failed: ['rate<0.01'] },
};
export default function () {
  const params = { headers: { Authorization: `Bearer ${tokens[__VU - 1]}` } };
  const path = `${base}/events/${__ENV.EVENT_ID}/queue`;
  if (__ITER === 0) check(http.post(path, null, params), { 'vào hàng thành công': r => r.status === 200 });
  const r = http.get(`${path}/me`, params);
  check(r, { 'hỏi trạng thái thành công': r => r.status === 200 });
  if (r.status === 200 && r.json('state') === 'NONE') http.post(path, null, params);
  sleep(3);
}
export function handleSummary(data) {
  return { stdout: `Phòng chờ: p95 = ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)} ms; ngưỡng p95 < 1000 ms\n` };
}
