<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../api/axios';
import AppAlert from '../components/AppAlert.vue';
import { Button } from '@/components/ui/button';

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
  <div class="min-h-screen flex flex-col items-center justify-center bg-surface px-4 py-12">
    <router-link :to="{ name: 'Home' }" class="mb-4 w-full max-w-md text-sm text-muted-foreground hover:text-foreground">
      ← Về trang chủ
    </router-link>
    <div class="max-w-md w-full space-y-8 bg-background p-8 rounded-lg border border-border">
      <div>
        <h2 class="text-center text-3xl font-extrabold text-foreground">
          Tạo tài khoản <span class="text-foreground">EventHub</span>
        </h2>
        <p class="mt-2 text-center text-sm text-muted-foreground">
          Đã có tài khoản?
          <router-link to="/login" class="font-medium text-foreground underline-offset-4 hover:underline">
            Đăng nhập
          </router-link>
        </p>
      </div>

      <AppAlert :message="errorMessage" type="error" class="mb-4" />

      <form class="mt-8 space-y-6" @submit.prevent="handleRegister">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-muted-foreground">Họ và tên</label>
            <input
              v-model="fullName"
              type="text"
              required
              class="mt-1 block w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              placeholder="Nguyễn Văn A"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-muted-foreground">Email</label>
            <input
              v-model="email"
              type="email"
              required
              class="mt-1 block w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-muted-foreground">Mật khẩu</label>
            <input
              v-model="password"
              type="password"
              required
              minlength="8"
              class="mt-1 block w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring text-sm"
              placeholder="•••••••• (tối thiểu 8 ký tự)"
            />
          </div>
        </div>

        <Button
          type="submit"
          class="w-full"
          :disabled="isLoading"
        >
          <span v-if="isLoading">Đang tạo tài khoản...</span>
          <span v-else>Đăng ký</span>
        </Button>
      </form>
    </div>
  </div>
</template>