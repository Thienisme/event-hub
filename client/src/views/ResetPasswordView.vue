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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
</script>
<template>
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <h1 class="text-2xl font-bold tracking-tight">Đặt lại mật khẩu</h1>
      <p class="mt-2 text-sm text-muted-foreground">Mật khẩu mới có ít nhất 8 ký tự.</p>
      <div v-if="typeof route.query.token !== 'string' || !route.query.token" class="mt-8 space-y-4">
        <AppAlert message="Liên kết không hợp lệ!" type="error" />
        <router-link to="/forgot-password" class="text-sm font-medium text-foreground underline-offset-4 hover:underline">Yêu cầu liên kết mới</router-link>
      </div>
      <form v-else @submit.prevent="submit" class="mt-8 space-y-4">
        <AppAlert :message="error" type="error" />
        <div class="space-y-2">
          <Label for="new-password">Mật khẩu mới</Label>
          <Input id="new-password" v-model="password" type="password" required class="h-10 bg-background shadow-none" minlength="8" autocomplete="new-password" />
        </div>
        <div class="space-y-2">
          <Label for="confirmation">Nhập lại mật khẩu</Label>
          <Input id="confirmation" v-model="confirmation" type="password" required class="h-10 bg-background shadow-none" minlength="8" autocomplete="new-password" />
        </div>
        <Button type="submit" class="w-full h-10" :disabled="busy">{{ busy ? 'Đang xử lý...' : 'Đặt lại mật khẩu' }}</Button>
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground"><router-link to="/login" class="font-medium text-foreground underline-offset-4 hover:underline">← Về trang đăng nhập</router-link></p>
    </div>
  </div>
</template>
