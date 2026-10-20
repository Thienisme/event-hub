/**
 * Kênh thông báo "phiên đăng nhập đã hết hạn".
 *
 * Vì sao không xử lý 401 trực tiếp trong axios interceptor?
 * - Interceptor không được biết route hiện tại -> không dựng được link quay lại.
 * - Dùng `window.location.href = '/login'` sẽ reload toàn trang: mất state của
 *   Pinia, mất trang user định quay lại, và đè lên logic redirect mà các view
 *   (EventDetailView, MyOrdersView) đã tự xử lý.
 * - Import `router` vào axios.ts sẽ tạo vòng import: router -> stores/auth ->
 *   api/axios -> router.
 *
 * Nên axios chỉ báo "có 401", còn main.ts đăng ký callback để điều hướng.
 * Module này không import gì -> không bao giờ gây vòng import.
 */
type SessionExpiredHandler = () => void;

let handler: SessionExpiredHandler | null = null;

/** Đăng ký callback xử lý khi token hết hạn (gọi 1 lần khi app khởi động). */
export const setSessionExpiredHandler = (fn: SessionExpiredHandler): void => {
  handler = fn;
};

/** Được axios gọi khi API trả về 401. */
export const notifySessionExpired = (): void => {
  handler?.();
};
