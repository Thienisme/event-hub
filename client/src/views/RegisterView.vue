<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../api/axios';
import AppAlert from '../components/AppAlert.vue';

const router = useRouter();

const fullName = ref('');
const email = ref('');
const password = ref('');

const isLoading = ref(false);
const errorMessage = ref('');

const handleRegister = async () => {
  if (!fullName.value || !email.value || !password.value) {
    errorMessage.value = 'Vui lòng điền đầy đủ các thông tin!';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    await apiClient.post('/auth/register', {
      fullName: fullName.value,
      email: email.value,
      password: password.value,
    });

    // Đăng ký thành công -> Chuyển qua trang Login
    router.push({ path: '/login', query: { registered: 'true' } });
  } catch (error: any) {
    errorMessage.value = error.response?.data?.message || 'Đăng ký thất bại, vui lòng thử lại!';
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
          Tạo tài khoản <span class="text-indigo-600">EventHub</span>
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600">
          Đã có tài khoản?
          <router-link to="/login" class="font-medium text-indigo-600 hover:text-indigo-500">
            Đăng nhập
          </router-link>
        </p>
      </div>

      <AppAlert :message="errorMessage" type="error" />

      <form class="mt-8 space-y-6" @submit.prevent="handleRegister">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Họ và tên</label>
            <input
              v-model="fullName"
              type="text"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="Nguyễn Văn A"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700">Email</label>
            <input
              v-model="email"
              type="email"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700">Mật khẩu</label>
            <input
              v-model="password"
              type="password"
              required
              minlength="8"
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="•••••••• (tối thiểu 8 ký tự)"
            />
          </div>
        </div>

        <button
          type="submit"
          :disabled="isLoading"
          class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
        >
          <span v-if="isLoading">Đang tạo tài khoản...</span>
          <span v-else>Đăng ký</span>
        </button>
      </form>
    </div>
  </div>
</template>