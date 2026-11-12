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
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-surface px-4 py-12">
    <router-link :to="{ name: 'Home' }" class="mb-4 w-full max-w-md text-sm text-muted-foreground hover:text-foreground">
      ← Về trang chủ
    </router-link>
    <div class="max-w-md w-full space-y-8 bg-background p-8 rounded-lg border border-border">
      <div>
        <h2 class="text-center text-3xl font-extrabold text-foreground">
          Đăng nhập <span class="text-foreground">EventHub</span>
        </h2>
        <p class="mt-2 text-center text-sm text-muted-foreground">
          Chưa có tài khoản?
          <router-link to="/register" class="font-medium text-foreground underline-offset-4 hover:underline">
            Đăng ký ngay
          </router-link>
        </p>
      </div>

      <AppAlert :message="successMessage" type="success" class="mb-4" />
      <AppAlert :message="errorMessage" type="error" class="mb-4" />

      <router-link to="/forgot-password" class="block text-sm text-foreground underline-offset-4 hover:underline">Quên mật khẩu?</router-link>

      <form class="mt-8 space-y-6" @submit.prevent="handleLogin">
        <div class="space-y-4">
          <div>
            <label for="email" class="block text-sm font-medium text-muted-foreground">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              class="mt-1 block w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-muted-foreground">Mật khẩu</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              class="mt-1 block w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <Button
            type="submit"
            class="w-full"
            :disabled="isLoading"
          >
            <span v-if="isLoading">Đang xử lý...</span>
            <span v-else>Đăng nhập</span>
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>