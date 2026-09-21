<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
    <p class="text-6xl font-extrabold text-indigo-600">404</p>
    <h1 class="mt-4 text-2xl font-bold text-gray-900">Không tìm thấy trang</h1>
    <p class="mt-2 text-sm text-gray-500">
      Đường dẫn bạn truy cập không tồn tại hoặc đã bị di chuyển.
    </p>
    <button
      class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
      @click="router.push({ name: 'Home' })"
    >
      Về trang chủ
    </button>
  </div>
</template>
