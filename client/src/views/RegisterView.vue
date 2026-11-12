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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <router-link :to="{ name: 'Home' }" class="mb-6 inline-block text-sm text-muted-foreground hover:text-foreground">← Về trang chủ</router-link>
      <h1 class="text-2xl font-bold tracking-tight">Tạo tài khoản EventHub</h1>
      <p class="mt-2 text-sm text-muted-foreground">Mua vé và quản lý sự kiện chỉ với một tài khoản.</p>
      <AppAlert :message="errorMessage" type="error" class="mt-4" />
      <form class="mt-8 space-y-4" @submit.prevent="handleRegister">
        <div class="space-y-2">
          <Label for="full-name">Họ và tên</Label>
          <Input id="full-name" v-model="fullName" type="text" required class="h-10 bg-background shadow-none" placeholder="Nguyễn Văn A" autocomplete="name" />
        </div>
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input id="email" v-model="email" type="email" required class="h-10 bg-background shadow-none" placeholder="you@example.com" autocomplete="email" />
        </div>
        <div class="space-y-2">
          <Label for="password">Mật khẩu</Label>
          <Input id="password" v-model="password" type="password" required class="h-10 bg-background shadow-none" minlength="8" autocomplete="new-password" placeholder="••••••••" aria-describedby="password-hint" />
        </div>
        <p id="password-hint" class="text-xs text-muted-foreground">Mật khẩu có ít nhất 8 ký tự.</p>
        <Button type="submit" class="w-full h-10" :disabled="isLoading">{{ isLoading ? 'Đang tạo tài khoản...' : 'Đăng ký' }}</Button>
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground">Đã có tài khoản? <router-link to="/login" class="font-medium text-foreground underline-offset-4 hover:underline">Đăng nhập</router-link></p>
    </div>
  </div>
</template>
