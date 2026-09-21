<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppAlert from '../components/AppAlert.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

// Chỉ nhận đường dẫn nội bộ: chặn open-redirect kiểu "//evil.com" hoặc "https://..."
const redirectPath = computed(() => {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
    ? target
    : '/';
});

// RegisterView chuyển sang đây kèm ?registered=true
const successMessage = computed(() =>
  route.query.registered === 'true' ? 'Đăng ký thành công! Hãy đăng nhập để tiếp tục.' : ''
);

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
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div class="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
      <div>
        <h2 class="text-center text-3xl font-extrabold text-gray-900">
          Đăng nhập <span class="text-indigo-600">EventHub</span>
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600">
          Chưa có tài khoản?
          <router-link to="/register" class="font-medium text-indigo-600 hover:text-indigo-500">
            Đăng ký ngay
          </router-link>
        </p>
      </div>

      <AppAlert :message="successMessage" type="success" />
      <AppAlert :message="errorMessage" type="error" />

      <form class="mt-8 space-y-6" @submit.prevent="handleLogin">
        <div class="space-y-4">
          <div>
            <label for="email" class="block text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-700">Mật khẩu</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            :disabled="isLoading"
            class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
          >
            <span v-if="isLoading">Đang xử lý...</span>
            <span v-else>Đăng nhập</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>