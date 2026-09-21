import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Tỉ lệ lỗi phía SERVER (5xx).
//
// 4xx KHÔNG tính là lỗi ở đây: hết vé (400) và lock bận (429) là kết quả
// MONG ĐỢI khi nhiều người tranh mua cùng một loại vé. Gộp chúng vào "lỗi"
// sẽ làm chỉ số vô nghĩa.
const serverErrorRate = new Rate('server_errors');

// Tách riêng để đọc được "thực sự tạo được bao nhiêu đơn".
const ordersCreated = new Counter('orders_created');
const ordersRejected = new Counter('orders_rejected');

export const options = {
  // Cấu hình kịch bản test: 100 Virtual Users (VU) cùng gửi request
  scenarios: {
    concurrent_ticket_purchase: {
      executor: 'per-vu-iterations',
      vus: 100,              // 100 người dùng đồng thời
      iterations: 1,         // Mỗi user thực hiện 1 lần mua vé
      maxDuration: '30s',    // Giới hạn tối đa thời gian chạy script
    },
  },
  // k6 mặc định chỉ in tới p(95) trong summary. Thêm p(99) để nhìn được phần
  // đuôi chậm — đúng chỗ mà p95 che mất.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],

  thresholds: {
    // Tiêu chí đánh giá (SLA): 95% request phải hoàn thành dưới 2 giây
    http_req_duration: ['p(95)<2000'],

    // Bắt buộc KHÔNG có lỗi server.
    //
    // Đây là lý do ngưỡng này tồn tại: check cũ gộp 500 chung với 400 trong
    // cùng một điều kiện, nên nếu BE trả 500 vì Prisma timeout thì test vẫn
    // "xanh" và ta không hề biết. Giờ 5xx bị tách ra và làm test FAIL thật sự.
    server_errors: ['rate==0'],
  },
};

// Cho phép trỏ tới server khác khi cần đo trên một instance riêng:
//   k6 run -e BASE_URL=http://localhost:5055/api load-test.js
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
// Truyền token qua biến môi trường thay vì dán cứng vào file:
//   k6 run -e TOKEN="$(curl -s -X POST http://localhost:5000/api/auth/login \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"...","password":"..."}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")" load-test.js
//
// Lý do không dán cứng: token là credential, không nên nằm trong file được commit.
// Token cũ trong file này còn bị ký bằng secret mặc định đã bị vá, nên nó đã hết
// hiệu lực — nay API sẽ trả 403 cho nó.
const TOKEN = __ENV.TOKEN || '';
const TICKET_TYPE_ID = '17353a03-9ae5-49bf-835f-824397ba3470'; // <-- Thay TicketType ID ở đây

export default function () {
  const url = `${BASE_URL}/orders`;

  const payload = JSON.stringify({
    ticketTypeId: TICKET_TYPE_ID,
    quantity: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  // Gửi request POST /api/orders
  const res = http.post(url, payload, params);

  // Phân loại kết quả:
  //   201 = tạo được đơn
  //   400 = hết vé (AppError)      -> client không nên thử lại y nguyên
  //   429 = lock bận / quá tải     -> client CÓ THỂ thử lại sau
  //   5xx = server hỏng            -> bug hoặc hạ tầng có vấn đề
  serverErrorRate.add(res.status >= 500);
  if (res.status === 201) ordersCreated.add(1);
  if (res.status === 400 || res.status === 429) ordersRejected.add(1);

  check(res, {
    // Thứ duy nhất thực sự báo server có vấn đề.
    'không có lỗi server (không 5xx)': (r) => r.status < 500,
    // Mọi kết quả nằm trong tập mong đợi của một cuộc tranh mua.
    'kết quả hợp lệ (201 | 400 | 429)': (r) => [201, 400, 429].includes(r.status),
  });

  sleep(0.1);
}
