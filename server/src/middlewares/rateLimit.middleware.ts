import rateLimit from 'express-rate-limit';

/**
 * Rate limiter cho các endpoint xác thực (login/register).
 * 
 * Bảo vệ chống brute-force password và mass account creation.
 * Cho phép tối đa 5 lần thử trong 15 phút cho mỗi IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // tối đa 5 request trong khoảng thời gian trên
  message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.',
  standardHeaders: true, // trả về rate limit info trong header `RateLimit-*`
  legacyHeaders: false, // vô hiệu header `X-RateLimit-*`
});

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