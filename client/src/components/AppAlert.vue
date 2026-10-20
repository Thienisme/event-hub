<script setup lang="ts">
defineProps<{
  type?: 'error' | 'success';
  message: string;
}>();
</script>

<template>
  <!--
    KHÔNG đặt margin (mb-*) cứng ở đây.
    Alert được nhúng ở nhiều nơi: trong form (cần khoảng cách dưới), trong hàng
    flex ngang (margin sẽ làm lệch hàng), hoặc làm thông báo cuối cùng (thừa
    khoảng trắng). Để component cha quyết định margin qua class truyền vào.
  -->
  <div
    v-if="message"
    :class="[
      'p-3 rounded-lg text-sm font-medium',
      type === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-600 border border-green-200'
    ]"
  >
    {{ message }}
  </div>
</template>
