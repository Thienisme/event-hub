/**
 * Prisma dùng kiểu Decimal cho price/totalAmount -> JSON trả về là CHUỖI (vd "150000").
 * Vì vậy luôn ép Number() trước khi format, nếu không toLocaleString sẽ ra sai kết quả.
 */
export const formatPrice = (value: number | string): string =>
  `${Number(value).toLocaleString('vi-VN')} đ`;

/** "T5, 18/09/2026 19:30" */
export const formatDateTime = (dateString: string): string =>
  new Date(dateString).toLocaleString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
