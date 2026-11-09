/**
 * Số phút giữ chỗ cho một đơn PENDING.
 * Khớp với comment trong prisma/schema.prisma: `expiresAt DateTime? // Giữ chỗ trong 10 phút`
 * Có thể override bằng biến môi trường ORDER_HOLD_MINUTES.
 */
export const ORDER_HOLD_MINUTES = Number(process.env.ORDER_HOLD_MINUTES ?? 10);

/** Thời điểm một đơn tạo ở `from` sẽ hết hạn giữ chỗ */
export const buildExpiresAt = (from: Date = new Date()): Date =>
  new Date(from.getTime() + ORDER_HOLD_MINUTES * 60 * 1000);

/**
 * Số vé tối đa một tài khoản được giữ hoặc sở hữu trong MỘT sự kiện, tính cả đơn
 * PENDING và CONFIRMED. Chặn việc một tài khoản giữ hết vé bằng cách đặt liên tục.
 */
export const MAX_TICKETS_PER_USER_PER_EVENT = Number(
  process.env.MAX_TICKETS_PER_USER_PER_EVENT ?? 100
);

/**
 * Thanh toán hiện là GIẢ LẬP: ai giữ đơn cũng tự xác nhận được mà không trả tiền.
 * Vì vậy production mặc định tắt, chỉ bật khi cố ý đặt ALLOW_SIMULATED_PAYMENT=true.
 */
export const isSimulatedPaymentEnabled = (): boolean =>
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_SIMULATED_PAYMENT === 'true';
