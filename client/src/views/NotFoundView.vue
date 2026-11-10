<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Home } from '@lucide/vue';

import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="min-h-[70vh] bg-surface flex flex-col items-center justify-center px-4 text-center">
    <p class="text-9xl tracking-tighter font-semibold tabular-nums text-primary">404</p>
    <h1 class="mt-4 text-2xl font-semibold text-foreground">Không tìm thấy trang</h1>
    <p class="mt-2 text-sm text-muted-foreground">
      Đường dẫn bạn truy cập không tồn tại hoặc đã bị di chuyển.
    </p>
    <Button class="mt-6"
      @click="router.push({ name: 'Home' })"
     variant="default" size="sm">
      <Home class="size-4" aria-hidden="true" /> Về trang chủ
    </Button>
  </div>
</template>
