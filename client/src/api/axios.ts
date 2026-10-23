import axios from 'axios';
import {
  notifySessionExpired,
  notifyAccountBlocked,
  notifyPermissionChanged,
} from './session';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Request Interceptor: Tự động đính kèm Token vào Header
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Phân biệt "phiên đăng nhập hết hạn" với "không đủ quyền".
 *
 * BE trả 403 cho NHIỀU nguyên nhân khác nhau:
 * - middleware `authenticate`: token hỏng/hết hạn -> message "Token không hợp lệ..."
 * - middleware `authenticate`: tài khoản bị khoá -> message "Tài khoản đã bị khoá!"
 * - middleware `authorize`: user không có quyền -> message "Bạn không có quyền..."
 *
 * Chỉ trường hợp đầu mới được coi là hết phiên. Nếu coi cả 403 là hết phiên thì
 * user bị từ chối quyền (vd CUSTOMER cố tạo sự kiện) sẽ bị đăng xuất oan.
 *
 * Tài khoản bị khoá thì phiên cũng coi như kết thúc (token còn hạn nhưng không
 * dùng được nữa), nhưng cần thông báo riêng để user biết lý do.
 */
const isSessionExpired = (error: any): boolean => {
  const status = error?.response?.status;

  if (status === 401) return true;

  if (status === 403) {
    const message = error?.response?.data?.message ?? '';
    return /token/i.test(message);
  }

  return false;
};

/** Tài khoản bị khoá -> phiên không còn dùng được, cần đưa user về trang đăng nhập. */
const isAccountBlocked = (error: any): boolean => {
  if (error?.response?.status !== 403) return false;
  const message = error?.response?.data?.message ?? '';
  return /bị khoá|đã bị khoá|khoá tài khoản/i.test(message);
};

/**
 * Không đủ quyền -> nhiều khả năng admin vừa đổi role của user. Ta báo để app
 * lấy lại profile, tránh UI còn hiển thị quyền cũ (vd vẫn thấy mục "Quản lý
 * sự kiện" dù đã bị hạ quyền).
 */
const isPermissionDenied = (error: any): boolean => {
  if (error?.response?.status !== 403) return false;
  const message = error?.response?.data?.message ?? '';
  return /không có quyền/i.test(message);
};

// Response Interceptor: Xử lý lỗi toàn cục (VD: Token hết hạn -> Logout)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Token hết hạn/hỏng -> xoá token và báo cho app điều hướng sang /login.
    // KHÔNG dùng `window.location.href` ở đây: nó reload toàn trang, mất state
    // Pinia, mất trang user định quay lại và đè lên logic redirect của từng view.
    // Xem client/src/api/session.ts để hiểu luồng đầy đủ.
    if (isSessionExpired(error)) {
      localStorage.removeItem('token');
      notifySessionExpired();
      return Promise.reject(error);
    }

    // Tài khoản bị khoá -> token còn hạn cũng không dùng được nữa, coi như hết phiên
    // nhưng báo lý do riêng để user biết vì sao bị đưa về trang đăng nhập.
    if (isAccountBlocked(error)) {
      localStorage.removeItem('token');
      notifyAccountBlocked(error?.response?.data?.message ?? 'Tài khoản đã bị khoá!');
      return Promise.reject(error);
    }

    // Không đủ quyền -> có thể admin vừa đổi role; báo để app lấy lại profile.
    if (isPermissionDenied(error)) {
      notifyPermissionChanged();
    }

    return Promise.reject(error);
  }
);

export default apiClient;