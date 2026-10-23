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
    } catch (error) {
      // Token hỏng/hết hạn -> dọn sạch state, tránh trạng thái "đăng nhập ma"
      logout();
    }
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
    logout,
  };
});