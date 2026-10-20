import axios from 'axios';
import { notifySessionExpired } from './session';

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
 * BE trả 403 cho HAI nguyên nhân khác nhau:
 * - middleware `authenticate`: token hỏng/hết hạn -> message "Token không hợp lệ..."
 * - middleware `authorize`: user không có quyền -> message "Bạn không có quyền..."
 * Chỉ trường hợp đầu mới được coi là hết phiên. Nếu coi cả 403 là hết phiên thì
 * user bị từ chối quyền (vd CUSTOMIZER cố tạo sự kiện) sẽ bị đăng xuất oan.
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
    }
    return Promise.reject(error);
  }
);

export default apiClient;