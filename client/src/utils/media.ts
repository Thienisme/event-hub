import apiClient from '../api/axios';

/** Giới hạn dung lượng ảnh banner: 5MB (khớp với giới hạn của endpoint /uploads). */
export const MAX_BANNER_BYTES = 5 * 1024 * 1024;

/** Các định dạng ảnh server chấp nhận (khớp với endpoint /uploads). */
export const ALLOWED_BANNER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Chuyển đường dẫn ảnh thành URL đầy đủ để hiển thị.
 *
 * Server trả về `bannerUrl` dạng đường dẫn tương đối "/uploads/<file>" (không
 * có host), nên cần ghép với origin của API để <img> tải được ảnh. API origin
 * được suy ra từ baseURL của apiClient: ví dụ "http://localhost:5055/api"
 * -> "http://localhost:5055"; còn baseURL "/api" (production cùng host) ->
 * dùng luôn window.location.origin.
 *
 * URL tuyệt đối (http/https) hoặc giá trị khác trả nguyên văn.
 */
export const resolveMediaUrl = (url?: string | null): string | null => {
  if (!url) return null;

  if (url.startsWith('/uploads/')) {
    const baseURL = apiClient.defaults.baseURL ?? '';
    const apiOrigin = new URL(baseURL, window.location.origin).origin;
    return `${apiOrigin}${url}`;
  }

  return url;
};
