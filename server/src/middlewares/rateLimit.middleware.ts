import rateLimit from 'express-rate-limit';

/**
 * Rate limiter chung cho toàn bộ API.
 * Ngăn chặn abuse và DDoS nhẹ.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 100, // tối đa 100 request/phút
  message: 'Quá nhiều yêu cầu. Vui lòng giảm tốc độ gửi request.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter cho đặt vé.
 * 
 * Thiết kế linh hoạt theo thực tế nền tảng vé thực tế:
 * - Cho phép đặt vé liên tiếp trong một khoảng thời gian ngắn (burst)
 * - Nhưng giới hạn tổng số vé đặt trong một khung thời gian dài
 * - Tránh trải nghiệm xấu cho người dùng thực khi mua nhiều vé cho cùng sự kiện
 */
export const orderRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phút
  max: 15, // tối đa 15 lần đặt vé trong 5 phút
  message: 'Tần suất đặt vé quá nhanh. Vui lòng thử lại sau vài phút.',
  standardHeaders: true,
  legacyHeaders: false,
});