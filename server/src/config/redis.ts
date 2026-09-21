import Redis from 'ioredis';
import Redlock from 'redlock';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

/**
 * Client cho REDLOCK. Cần KIÊN NHẪN: không lấy được lock là chuyện bình thường
 * khi tải cao, nên phải chờ kết nối lại rồi thử tiếp (hành vi mặc định của ioredis).
 */
export const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

redisClient.on('connect', () => {
  console.log('✅ Redis Client connected');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Error:', err);
});

/**
 * Client RIÊNG cho CACHE. Cố tình ngược tính cách với `redisClient` ở trên.
 *
 * Vì sao phải tách: hai bên có yêu cầu trái nhau.
 *  - Redlock cần chờ đợi và thử lại.
 *  - Cache cần THẤT BẠI NHANH. Cache chỉ là tối ưu tốc độ; nó không được phép
 *    giữ request của người dùng.
 *
 * Với cấu hình mặc định (hàng đợi offline bật, thử lại 20 lần), khi Redis chết
 * thì `GET /api/events` đã TREO 63,09 GIÂY rồi mới trả 500 — tức cache trở thành
 * điểm chết duy nhất của cả hệ thống, đúng thứ mà nó sinh ra để tránh.
 */
export const cacheClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,

  // Redis chết -> báo lỗi ngay, không xếp lệnh vào hàng đợi chờ kết nối lại.
  enableOfflineQueue: false,

  // Một lệnh cache không đáng để thử lại: thà đọc database còn hơn.
  maxRetriesPerRequest: 1,

  // Chặn trên cho mỗi lệnh. Redis đang chậm bất thường thì bỏ luôn và đi đọc
  // database. Đặt cao hơn nhiều so với độ trễ thật (~0,1 ms) để không cắt oan.
  commandTimeout: 200,
});

// Lỗi Redis của cache được xử lý bằng fail-open (xem utils/cache.ts), nên ở đây
// chỉ log để biết chuyện gì đang xảy ra — và log có tiết chế, vì client này có
// thể phát lỗi ở mỗi lệnh khi Redis chết.
let lastCacheErrorLogAt = 0;
cacheClient.on('error', (err) => {
  const now = Date.now();
  if (now - lastCacheErrorLogAt < 10_000) return;
  lastCacheErrorLogAt = now;
  console.error(
    `❌ [cache] Redis lỗi, đang phục vụ trực tiếp từ database: ${err.message}`
  );
});

export const redlock = new Redlock([redisClient], {
  driftFactor: 0.01,
  retryCount: 30,
  retryDelay: 100,
  retryJitter: 100,
});
