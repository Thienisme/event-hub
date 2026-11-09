import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../api/axios';

/**
 * Khớp đúng enum Role trong prisma/schema.prisma của BE.
 * CHÚ Ý: BE không có role 'USER' mà là 'CUSTOMER'.
 */
export type UserRole = 'CUSTOMER' | 'ORGANIZER' | 'ADMIN';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));
  let profileRequest: Promise<void> | null = null;

  const isAuthenticated = computed(() => !!token.value);
  const isOrganizer = computed(() => user.value?.role === 'ORGANIZER' || user.value?.role === 'ADMIN');
  const isAdmin = computed(() => user.value?.role === 'ADMIN');

  // Đăng nhập
  async function login(credentials: { email: string; password: string }) {
    const response = await apiClient.post('/auth/login', credentials);
    token.value = response.data.token;
    user.value = response.data.user;
    
    localStorage.setItem('token', response.data.token);
    return response.data;
  }

  // Lấy thông tin người dùng hiện tại (dùng khi F5 vì `user` chỉ nằm trong RAM)
  async function fetchProfile() {
    if (!token.value) return;
    try {
      const response = await apiClient.get<{ user: User }>('/auth/me');
      user.value = response.data.user;
    } catch (error: any) {
      // Token hỏng/hết hạn hoặc tài khoản không còn -> dọn sạch state, tránh trạng
      // thái "đăng nhập ma". Lỗi mạng hay 5xx thì giữ phiên: server chập chờn không
      // phải lý do để đăng xuất người dùng.
      if ([401, 403, 404].includes(error?.response?.status)) {
        logout();
      }
    }
  }

  /**
   * Bảo đảm đã có `user` khi đang giữ token. Các lời gọi đồng thời dùng chung một
   * request, để router guard và main.ts không gọi /auth/me hai lần.
   */
  function ensureProfile(): Promise<void> {
    if (!token.value || user.value) return Promise.resolve();

    profileRequest ??= fetchProfile().finally(() => {
      profileRequest = null;
    });
    return profileRequest;
  }

  // Đăng xuất
  function logout() {
    user.value = null;
    token.value = null;
    localStorage.removeItem('token');
  }

  return {
    user,
    token,
    isAuthenticated,
    isOrganizer,
    isAdmin,
    login,
    fetchProfile,
    ensureProfile,
    logout,
  };
});