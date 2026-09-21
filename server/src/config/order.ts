/**
 * Số phút giữ chỗ cho một đơn PENDING.
 * Khớp với comment trong prisma/schema.prisma: `expiresAt DateTime? // Giữ chỗ trong 10 phút`
 * Có thể override bằng biến môi trường ORDER_HOLD_MINUTES.
 */
export const ORDER_HOLD_MINUTES = Number(process.env.ORDER_HOLD_MINUTES ?? 10);

/** Thời điểm một đơn tạo ở `from` sẽ hết hạn giữ chỗ */
export const buildExpiresAt = (from: Date = new Date()): Date =>
  new Date(from.getTime() + ORDER_HOLD_MINUTES * 60 * 1000);
