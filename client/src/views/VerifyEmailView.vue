<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import apiClient from '@/api/axios';
import AppAlert from '@/components/AppAlert.vue';
import { useAuthStore } from '@/stores/auth';
const route = useRoute();
const auth = useAuthStore();
const error = ref('');
const message = ref('Đang xác minh email...');
watch(() => route.query.token, async (token) => {
  error.value = '';
  message.value = 'Đang xác minh email...';
  if (typeof token !== 'string' || !token) { error.value = 'Liên kết xác minh không hợp lệ!'; message.value = ''; return; }
  try {
    const { data } = await apiClient.post('/auth/verify-email', { token });
    message.value = data.message;
    await auth.fetchProfile();
  } catch (err: any) {
    message.value = '';
    error.value = err.response?.data?.message || 'Không thể xác minh email. Vui lòng thử lại.';
  }
}, { immediate: true });
</script>
<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="border border-border rounded-lg bg-background p-6 space-y-6">
      <h1 class="text-3xl font-extrabold tracking-tight">Xác minh email</h1>
      <AppAlert :message="error" type="error" />
      <p v-if="message" role="status" class="text-sm text-muted-foreground">{{ message }}</p>
      
      <router-link to="/login" class="block text-sm text-foreground underline-offset-4 hover:underline">Về trang đăng nhập</router-link>
    </div>
  </div>
</template>
