/**
 * Múi giờ nghiệp vụ của ứng dụng.
 *
 * Node KHÔNG có `date_default_timezone_set` như PHP, nên không tồn tại "timezone
 * mặc định của app" ở mức ngôn ngữ. Hai cách tương đương:
 * - BE: đặt biến môi trường `TZ` (giống date_default_timezone_set, ảnh hưởng
 *   toàn process).
 * - FE: chỉ định `timeZone` tường minh cho Intl.DateTimeFormat (giống Carbon
 *   ::setTimezone) -> kết quả không phụ thuộc timezone của máy người dùng.
 *
 * Vite chỉ expose env có tiền tố VITE_ sang client, nên biến ở đây phải là
 * VITE_APP_TIMEZONE chứ không phải APP_TIMEZONE.
 */
const APP_TIMEZONE = import.meta.env?.VITE_APP_TIMEZONE || 'Asia/Ho_Chi_Minh';

export { APP_TIMEZONE };

/**
 * Prisma dùng kiểu Decimal cho price/totalAmount -> JSON trả về là CHUỖI (vd "150000").
 * Vì vậy luôn ép Number() trước khi format, nếu không toLocaleString sẽ ra sai kết quả.
 */
export const formatPrice = (value: number | string | null | undefined): string => {
  // Number(null) và Number('') đều ra 0 -> sẽ hiện "0 đ" cho dữ liệu chưa có giá.
  if (value === null || value === undefined || value === '') return '—';

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';

  return `${parsed.toLocaleString('vi-VN')} đ`;
};

/** "T5, 18/09/2026 19:30" — luôn theo múi giờ nghiệp vụ, không theo máy user. */
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: APP_TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDateTime = (dateString: string | null | undefined): string => {
  if (!dateString) return '—';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';

  return dateTimeFormatter.format(date);
};

/** Lấy các thành phần ngày/giờ của một instant theo múi giờ nghiệp vụ. */
const appPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const offsetPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Offset của múi giờ (tính bằng ms) tại một instant cho trước.
 * offset = (giờ hiển thị theo múi giờ) - (giờ UTC).
 */
const getTimeZoneOffset = (utcMs: number): number => {
  const parts: Record<string, string> = {};
  for (const part of offsetPartsFormatter.formatToParts(new Date(utcMs))) {
    parts[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - utcMs;
};

/**
 * BE luôn trả DateTime theo chuẩn ISO ở UTC (vd "2026-10-03T19:00:00.000Z").
 * <input type="datetime-local"> lại hiển thị giờ địa phương của MÁY NGƯỜI DÙNG.
 *
 * Trước đây code cắt thẳng chuỗi ISO: startTime.slice(0, 16) -> "2026-10-03T19:00",
 * tức là đưa giờ UTC vào ô nhập. Người dùng VN nhìn thấy giờ lệch 7 tiếng so với
 * thực tế, và lúc lưu `new Date("2026-10-03T19:00").toISOString()` lại hiểu chuỗi
 * đó là giờ địa phương -> lệch thêm 7 tiếng. Mỗi lần bấm "Cập nhật" là lệch thêm.
 *
 * Hai hàm dưới đây quy đổi đúng 2 chiều giữa instant UTC và giờ nghiệp vụ.
 */

/** Instant (ISO) -> giờ nghiệp vụ cho <input type="datetime-local"> */
export const toAppDateTimeInput = (iso: string | null | undefined): string => {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const parts: Record<string, string> = {};
  for (const part of appPartsFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

/**
 * Giờ nghiệp vụ của <input type="datetime-local"> -> instant ISO UTC để gửi BE.
 *
 * Cách làm: coi chuỗi nhập vào là giờ UTC để có instant "giả", trừ đi offset của
 * múi giờ tại instant đó là ra instant thật. Có làm thêm một vòng hiệu chỉnh vì
 * vùng có DST thì offset ở instant "giả" và instant thật có thể khác nhau.
 */
export const fromAppDateTimeInput = (value: string): string => {
  if (!value) return '';

  const asUtc = Date.parse(`${value}:00Z`);
  if (Number.isNaN(asUtc)) return '';

  const offsetGuess = getTimeZoneOffset(asUtc);
  let result = asUtc - offsetGuess;

  const offsetAtResult = getTimeZoneOffset(result);
  if (offsetAtResult !== offsetGuess) {
    result = asUtc - offsetAtResult;
  }

  return new Date(result).toISOString();
};
