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
 * Rate limiter cho nhóm API quản trị.
 *
 * Giới hạn chặt hơn API thường (30/phút thay vì 100/phút) vì đây là nhóm thao tác
 * nhạy cảm: đổi vai trò, khoá tài khoản. Nếu bị lạm dụng thì hậu quả nặng hơn
 * nhiều so với việc đọc danh sách sự kiện.
 */
export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 30, // tối đa 30 request/phút
  message: 'Quá nhiều thao tác quản trị. Vui lòng giảm tốc độ.',
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
 *
 * KHOÁ THEO TÀI KHOẢN, KHÔNG THEO IP:
 *
 * Limiter này chạy SAU `authenticate` nên `req.user` luôn có sẵn. Nếu khoá theo
 * IP thì nhiều người dùng thật dùng chung một IP (văn phòng, trường đại học,
 * WiFi nhà, mạng di động) sẽ bị chặn oan chỉ vì người khác đã đặt nhiều vé.
 * Ngược lại, bot đổi IP vẫn bị chặn vì hạn mức gắn với tài khoản.
 *
 * `req.ip` chỉ là fallback cho trường hợp không xác thực (không xảy ra với
 * route hiện tại, nhưng để limiter không bao giờ ném lỗi).
 */
export const orderRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phút
  max: 15, // tối đa 15 lần đặt vé trong 5 phút
  keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'unknown',
  message: 'Tần suất đặt vé quá nhanh. Vui lòng thử lại sau vài phút.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter cho xác thực (login, register).
 *
 * Chống brute-force mật khẩu: 5 lần THẤT BẠI thì chặn 1 phút.
 * `skipSuccessfulRequests: true` khiến chỉ request trả về lỗi (4xx/5xx)
 * mới được đếm — người dùng đăng nhập thành công không bị trừ hạn,
 * nên một người gõ sai 4 lần rồi nhập đúng vẫn dùng bình thường.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 5, // tối đa 5 lần thất bại trong 1 phút
  skipSuccessfulRequests: true, // chỉ đếm request THẤT BẠI ("sai 5 lần")
  message:
    'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 1 phút!',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter cho đăng ký tài khoản.
 *
 * Không dùng `skipSuccessfulRequests` vì mục đích là **chống spam account**,
* không phải brute-force mật khẩu. Mỗi lần đăng ký thành công đều tốn chi phí
 * (bcrypt + ghi DB + có thể gửi email xác thực), nên phải giới hạn **tổng số lần**
 * regardless of success/failure.
 */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 10, // tối đa 10 lần đăng ký (thành công hay thất bại) trong 1 phút
  message:
    'Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 1 phút!',
  standardHeaders: true,
  legacyHeaders: false,
});