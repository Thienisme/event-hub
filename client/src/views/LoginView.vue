<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppAlert from '../components/AppAlert.vue';
import { Button } from '@/components/ui/button';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

// Chỉ nhận đường dẫn nội bộ: chặn open-redirect kiểu "//evil.com" hoặc "https://..."
// Lưu ý: phải chặn cả backslash. Trình duyệt chuẩn hoá "\" thành "/" ở một số ngữ cảnh,
// nên "/\evil.com" có thể bị hiểu như "//evil.com" (protocol-relative) và redirect ra ngoài.
const redirectPath = computed(() => {
  const target = route.query.redirect;
  const isSafeInternalPath =
    typeof target === 'string' &&
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !target.includes('\\');
  return isSafeInternalPath ? target : '/';
});

// RegisterView chuyển sang đây kèm ?registered=true, ResetPasswordView kèm ?reset=true
const successMessage = computed(() => {
  if (route.query.registered === 'true') return 'Đăng ký thành công! Hãy đăng nhập để tiếp tục.';
  if (route.query.reset === 'true') return 'Đặt lại mật khẩu thành công! Hãy đăng nhập bằng mật khẩu mới.';
  return '';
});

const email = ref('');
const password = ref('');
const isLoading = ref(false);
const errorMessage = ref('');

const handleLogin = async () => {
  if (!email.value || !password.value) {
    errorMessage.value = 'Vui lòng nhập đầy đủ Email và Mật khẩu!';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    await authStore.login({ email: email.value, password: password.value });
    // Quay lại đúng trang user định vào trước khi bị chặn (vd trang chi tiết sự kiện)
    router.push(redirectPath.value);
  } catch (error: any) {
    errorMessage.value = error.response?.data?.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin!';
  } finally {
    isLoading.value = false;
  }
};
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <router-link :to="{ name: 'Home' }" class="mb-6 inline-block text-sm text-muted-foreground hover:text-foreground">← Về trang chủ</router-link>
      <h1 class="text-2xl font-bold tracking-tight">Đăng nhập EventHub</h1>
      <p class="mt-2 text-sm text-muted-foreground">Chào mừng trở lại. Đăng nhập để tiếp tục.</p>
      <AppAlert :message="successMessage" type="success" class="mt-4" />
      <AppAlert :message="errorMessage" type="error" class="mt-4" />
      <form class="mt-8 space-y-4" @submit.prevent="handleLogin">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input id="email" v-model="email" type="email" required class="h-10 bg-background shadow-none" placeholder="you@example.com" autocomplete="email" />
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <Label for="password">Mật khẩu</Label>
            <router-link to="/forgot-password" class="text-sm text-muted-foreground hover:text-foreground">Quên mật khẩu?</router-link>
          </div>
          <Input id="password" v-model="password" type="password" required autocomplete="current-password" placeholder="••••••••" class="h-10 bg-background shadow-none" />
        </div>
        <Button type="submit" class="w-full h-10" :disabled="isLoading">{{ isLoading ? 'Đang xử lý...' : 'Đăng nhập' }}</Button>
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground">Chưa có tài khoản? <router-link to="/register" class="font-medium text-foreground underline-offset-4 hover:underline">Đăng ký</router-link></p>
    </div>
  </div>
</template>
