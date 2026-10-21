import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const serverErrorRate = new Rate('server_errors');
const ordersCreated = new Counter('orders_created');
const ordersRejected = new Counter('orders_rejected');

// Test với 200 VUs đồng thời đặt vé cho Concert Âm Nhạc Hà Anh Tuấn - VIP1 (chỉ 10 vé)
export const options = {
  scenarios: {
    stress_test: {
      executor: 'per-vu-iterations',
      vus: 200,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    server_errors: ['rate==0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
// Ticket type được bắn vào. Mặc định là VIP1 (10 vé) của sự kiện cũ, nhưng nên
// truyền qua biến môi trường để chạy lại được sau khi kho đã bán hết:
//   k6 run -e TICKET_TYPE_ID=<id> load-test-concurrent.js
// Lưu ý: kho phải được reset về đúng số vé dự kiến trước khi chạy, nếu không
// số đơn tạo được sẽ khác số vé có sẵn và kết luận sẽ sai.
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID || '8f8dd54e-16bb-49dc-b0fd-29ea7b9866ac';

export default function () {
  // Đăng nhập với admin để có token
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'admin@test.com',
    password: 'admin12345',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, {
    'login thành công': (r) => r.status === 200,
  });

  if (loginRes.status !== 200) {
    check(loginRes, {
      'login thất bại - không thể tiếp tục': () => false,
    });
    sleep(1);
    return;
  }

  let token = '';
  try {
    const body = JSON.parse(loginRes.body);
    token = body.token;
  } catch (e) {
    sleep(1);
    return;
  }

  // Đặt vé
  const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify({
    ticketTypeId: TICKET_TYPE_ID,
    quantity: 1,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  serverErrorRate.add(orderRes.status >= 500);
  if (orderRes.status === 201) ordersCreated.add(1);
  if (orderRes.status === 400 || orderRes.status === 429) ordersRejected.add(1);

  check(orderRes, {
    'đặt vé thành công hoặc bị từ chối hợp lệ': (r) => [200, 201, 400, 401, 403, 429].includes(r.status),
  });

  // Sleep ngắn để tạo áp lực đồng thời
  sleep(0.01);
};