<script setup lang="ts">
import { ref } from 'vue';
import apiClient from '@/api/axios';
import AppAlert from '@/components/AppAlert.vue';
import { Button } from '@/components/ui/button';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const busy = ref(false);
const error = ref('');
const password = ref('');
const confirmation = ref('');
async function submit() {
  error.value = '';
  if (password.value !== confirmation.value) { error.value = 'Mật khẩu nhập lại không khớp!'; return; }
  if (typeof route.query.token !== 'string' || !route.query.token) { error.value = 'Liên kết không hợp lệ!'; return; }
  busy.value = true;
  try {
    await apiClient.post('/auth/reset-password', { token: route.query.token, newPassword: password.value });
    password.value = ''; confirmation.value = '';
    // Đặt lại mật khẩu đã thu hồi mọi phiên cũ: xoá token trên máy này để trang
    // đăng nhập (guestOnly) không đá ngược ra, và dùng replace để link chứa token
    // không nằm lại trong lịch sử trình duyệt.
    authStore.logout();
    await router.replace({ name: 'Login', query: { reset: 'true' } });
  } catch (err: any) { error.value = err.response?.data?.message || 'Không thể xử lý yêu cầu. Vui lòng thử lại.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="border border-border rounded-lg bg-background p-6 space-y-6">
      <h1 class="text-3xl font-extrabold tracking-tight">Đặt lại mật khẩu</h1>
      <AppAlert :message="error" type="error" />
      <form @submit.prevent="submit" class="space-y-4"><div class="space-y-2"><label for="new-password" class="block text-sm font-medium">Mật khẩu mới</label><input id="new-password" v-model="password" type="password" required minlength="8" autocomplete="new-password" class="w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div><div class="space-y-2"><label for="confirmation" class="block text-sm font-medium">Nhập lại mật khẩu</label><input id="confirmation" v-model="confirmation" type="password" required minlength="8" autocomplete="new-password" class="w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div><Button type="submit" :disabled="busy">{{ busy ? "Đang xử lý..." : "Đặt lại mật khẩu" }}</Button></form>
      <router-link to="/login" class="block text-sm text-foreground underline-offset-4 hover:underline">Về trang đăng nhập</router-link>
    </div>
  </div>
</template>
