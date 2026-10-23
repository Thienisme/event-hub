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
type AccountBlockedHandler = (message: string) => void;
type PermissionChangedHandler = () => void;

let handler: SessionExpiredHandler | null = null;
let blockedHandler: AccountBlockedHandler | null = null;
let permissionChangedHandler: PermissionChangedHandler | null = null;

/** Đăng ký callback xử lý khi token hết hạn (gọi 1 lần khi app khởi động). */
export const setSessionExpiredHandler = (fn: SessionExpiredHandler): void => {
  handler = fn;
};

/**
 * Đăng ký callback xử lý khi tài khoản bị khoá.
 *
 * Tài khoản bị khoá thì mọi API đều trả 403. Nếu không xử lý riêng, app rơi vào
 * trạng thái "còn đăng nhập nhưng mọi thao tác đều lỗi" — rất khó chịu. Thay vào
 * đó ta đưa user về trang đăng nhập kèm lý do.
 */
export const setAccountBlockedHandler = (fn: AccountBlockedHandler): void => {
  blockedHandler = fn;
};

/**
 * Đăng ký callback xử lý khi quyền của user vừa bị thay đổi (admin đổi role
 * của họ). Callback sẽ lấy lại profile để UI cập nhật theo role mới.
 */
export const setPermissionChangedHandler = (fn: PermissionChangedHandler): void => {
  permissionChangedHandler = fn;
};

/** Được axios gọi khi API trả về 401. */
export const notifySessionExpired = (): void => {
  handler?.();
};

/** Được axios gọi khi API trả 403 vì tài khoản bị khoá. */
export const notifyAccountBlocked = (message: string): void => {
  blockedHandler?.(message);
};

/** Được axios gọi khi API trả 403 vì user không đủ quyền. */
export const notifyPermissionChanged = (): void => {
  permissionChangedHandler?.();
};
