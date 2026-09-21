import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

/**
 * Đo hiệu quả cache ở ĐƯỜNG ĐỌC.
 *
 * Khác với load-test.js (đo đường ghi / tranh chấp tồn kho), file này đo việc
 * giảm tải database — bài toán #2. Hai chỉ số quan trọng:
 *
 *   cache_hit_rate   — bao nhiêu % request được phục vụ từ Redis
 *   db_reads         — bao nhiêu request phải đọc thẳng MySQL
 *
 * CÁCH ĐO STAMPEDE (bắt buộc phải làm cache LẠNH trước):
 *
 *   redis-cli --scan --pattern 'events:list:*' | xargs -r redis-cli del
 *   k6 run load-test-read.js
 *
 * Nếu cache đang ấm sẵn, mọi request đều hit và bài test không nói lên điều gì:
 * stampede chỉ xảy ra ở đúng khoảnh khắc cache vừa hết hạn / vừa bị xoá.
 *
 * Chạy trang chi tiết thay vì danh sách:
 *   k6 run -e EVENT_ID=<uuid> load-test-read.js
 */

// Hai loại kết quả, tách riêng để đọc được đúng vấn đề.
const cacheHits = new Counter('cache_hits');
const dbReads = new Counter('db_reads');
const cacheHitRate = new Rate('cache_hit_rate');

// Chỉ 5xx mới là lỗi. 4xx là lỗi request, không phải lỗi hệ thống.
const serverErrors = new Rate('server_errors');

// Số VU cấu hình được, để kiểm chứng stampede lớn dần theo mức đồng thời:
//   k6 run -e VUS=500 -e BASE_URL=http://localhost:5055/api load-test-read.js
const VUS = Number(__ENV.VUS || 100);

export const options = {
  scenarios: {
    // N "người dùng" cùng vào trang chủ ở đúng một khoảnh khắc.
    cold_start_herd: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '60s',
    },
  },

  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],

  thresholds: {
    // 5xx không được phép xuất hiện. Kể cả khi Redis chết, cache phải fail-open
    // và phục vụ từ DB, chứ không được làm request của user thất bại.
    server_errors: ['rate==0'],
    http_req_duration: ['p(95)<2000'],
  },
};

// Cho phép trỏ tới server khác, cần thiết khi đo trên một instance riêng để đọc log:
//   k6 run -e BASE_URL=http://localhost:5055/api load-test-read.js
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
const EVENT_ID = __ENV.EVENT_ID || '';

export default function () {
  const path = EVENT_ID ? `/events/${EVENT_ID}` : '/events';
  const res = http.get(`${BASE_URL}${path}`);

  serverErrors.add(res.status >= 500);

  let source = null;
  try {
    source = res.json().source;
  } catch {
    /* response không phải JSON -> source giữ nguyên null, tính là DB */
  }

  if (source === 'cache') {
    cacheHits.add(1);
    cacheHitRate.add(1);
  } else {
    dbReads.add(1);
    cacheHitRate.add(0);
  }

  check(res, {
    'trả về 200': (r) => r.status === 200,
    'có field source (cache | database)': () => source === 'cache' || source === 'database',
  });
}
