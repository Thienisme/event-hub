<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import apiClient from '@/api/axios';
import { Button } from '@/components/ui/button';
import { Loader2, CircleCheck, CircleAlert } from '@lucide/vue';
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
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <div role="status" aria-live="polite">
        <CircleAlert v-if="error" class="mb-4 size-6 text-danger" aria-hidden="true" />
        <Loader2 v-else-if="message === 'Đang xác minh email...'" class="mb-4 size-6 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
        <CircleCheck v-else class="mb-4 size-6 text-success" aria-hidden="true" />
        <h1 class="text-2xl font-bold tracking-tight">Xác minh email</h1>
        <p class="mt-2 break-words text-sm text-muted-foreground">{{ error || message }}</p>
      </div>
      <Button as-child class="mt-8 w-full h-10"><router-link to="/login">Về trang đăng nhập</router-link></Button>
    </div>
  </div>
</template>
