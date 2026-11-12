<script setup lang="ts">
import { ref } from 'vue';
import apiClient from '@/api/axios';
import AppAlert from '@/components/AppAlert.vue';
import { Button } from '@/components/ui/button';
const busy = ref(false);
const error = ref('');
const message = ref('');
const email = ref('');
async function submit() {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    const { data } = await apiClient.post('/auth/forgot-password', { email: email.value });
    message.value = data.message;
  } catch (err: any) { error.value = err.response?.data?.message || 'Không thể xử lý yêu cầu. Vui lòng thử lại.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="border border-border rounded-lg bg-background p-6 space-y-6">
      <h1 class="text-3xl font-extrabold tracking-tight">Quên mật khẩu</h1>
      <AppAlert :message="error" type="error" />
      <p v-if="message" role="status" class="text-sm text-muted-foreground">{{ message }}</p>
      <form @submit.prevent="submit" class="space-y-4"><div class="space-y-2"><label for="email" class="block text-sm font-medium">Email</label><input id="email" v-model="email" type="email" required autocomplete="email" class="w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div><Button type="submit" :disabled="busy">{{ busy ? "Đang xử lý..." : "Gửi liên kết" }}</Button></form>
      <router-link to="/login" class="block text-sm text-foreground underline-offset-4 hover:underline">Về trang đăng nhập</router-link>
    </div>
  </div>
</template>
