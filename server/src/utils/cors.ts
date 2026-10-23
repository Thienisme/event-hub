/**
 * Whitelist CORS — tách riêng khỏi `app.ts` để TEST ĐƯỢC.
 *
 * Trước đây logic này nằm inline trong `app.ts` và chỉ quan sát được qua server
 * đang chạy. Bug "toán tử comma" bên dưới đã sống sót qua toàn bộ bộ test vì
 * các script test gọi API bằng `fetch` của Node — Node KHÔNG tự gửi header
 * `Origin`, nên nhánh "không có Origin -> cho qua" luôn đúng và whitelist
 * bao giờ không được kiểm tra.
 *
 * Tách ra đây để unit-test được trực tiếp, không cần dựng server.
 */

/**
 * Các origin dev mặc định. Vite đổi cổng tự động khi cổng đang bận (5173 →
 * 5174 → 5175...), nên phải cho phép dải cổng này, và cho cả `127.0.0.1` vì
 * `localhost` và `127.0.0.1` là hai origin KHÁC NHAU theo đặc tả CORS.
 */
export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:5176',
  'http://127.0.0.1:5176',
];

/**
 * Chuyển `CORS_ORIGINS` (chuỗi phân tách bằng dấu phẩy) thành mảng origin.
 *
 * ★ CẢNH BÁO: đừng bao giờ viết `a ?? 'b', 'c', 'd'` để làm việc này. Dấu
 * phẩy trong JavaScript là TOÁN TỬ COMMA (ưu tiên thấp nhất), nên biểu thức đó
 * được parse thành `(a ?? 'b'), 'c', 'd'` và CHỈ trả về phần tử cuối cùng. Mọi
 * thứ trước đó — kể cả biến môi trường — bị vứt bỏ mà không có lỗi nào báo.
 *
 * `CORS_ORIGINS` rỗng (hoặc chỉ có khoảng trắng) được coi là CHƯA ĐẶT và dùng
 * danh sách mặc định — vì `CORS_ORIGINS=` trong file .env là cái gõ quên mất
 * chứ không phải ý định "chặn tất cả". Nếu để rỗng thành whitelist rỗng thì mọi
 * request từ trình duyệt đều bị chặn, và triệu chứng là "lỗi CORS" ở mọi màn
 * hình mà không ai đoán ra nguyên nhân.
 *
 * @param raw giá trị của biến môi trường `CORS_ORIGINS` (undefined nếu chưa đặt)
 */
export function parseAllowedOrigins(raw?: string | null): string[] {
  const source = raw?.trim() ? raw : DEFAULT_CORS_ORIGINS.join(',');
  return source
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
