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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MailCheck } from '@lucide/vue';
</script>
<template>
  <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm">
      <h1 class="text-2xl font-bold tracking-tight">Quên mật khẩu</h1>
      <p class="mt-2 text-sm text-muted-foreground">Nhập email của tài khoản. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu, có hiệu lực 30 phút.</p>
      <AppAlert :message="error" type="error" class="mt-4" />
      <div v-if="message" role="status" class="mt-8 space-y-4">
        <MailCheck class="size-6 text-success" aria-hidden="true" />
        <p class="break-words text-sm">{{ message }}</p>
        <p class="text-sm text-muted-foreground">Không thấy thư? Kiểm tra mục Spam.</p>
        <Button type="button" variant="outline" class="w-full h-10 shadow-none" :disabled="busy" @click="submit">{{ busy ? 'Đang xử lý...' : 'Gửi lại' }}</Button>
      </div>
      <form v-else @submit.prevent="submit" class="mt-8 space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input id="email" v-model="email" type="email" required class="h-10 bg-background shadow-none" placeholder="you@example.com" autocomplete="email" />
        </div>
        <Button type="submit" class="w-full h-10" :disabled="busy">{{ busy ? 'Đang xử lý...' : 'Gửi liên kết' }}</Button>
      </form>
      <p class="mt-6 text-center text-sm text-muted-foreground"><router-link to="/login" class="font-medium text-foreground underline-offset-4 hover:underline">← Về trang đăng nhập</router-link></p>
    </div>
  </div>
</template>
