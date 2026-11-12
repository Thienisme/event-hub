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
  avatarUrl?: string | null;
  email: string;
  role: UserRole;
  createdAt?: string;
  emailVerifiedAt: string | null;
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

  async function updateProfile(fullName: string) {
    const response = await apiClient.patch<{ message: string; user: User }>('/auth/me', { fullName });
    user.value = response.data.user;
    return response.data;
  }

  async function updateAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    // Bỏ mặc định JSON để trình duyệt tự đặt multipart/form-data kèm boundary.
    const { data } = await apiClient.post<{ user: User }>('/auth/me/avatar', form, {
      headers: { 'Content-Type': undefined },
    });
    user.value = data.user;
  }

  async function removeAvatar() {
    const { data } = await apiClient.delete<{ user: User }>('/auth/me/avatar');
    user.value = data.user;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const response = await apiClient.post<{ message: string; token: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    token.value = response.data.token;
    localStorage.setItem('token', response.data.token);
    return response.data;
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
    updateProfile,
    updateAvatar,
    removeAvatar,
    changePassword,
    fetchProfile,
    ensureProfile,
    logout,
  };
});
