<script setup lang="ts">
defineProps<{
  type?: 'error' | 'success';
  message: string;
}>();
</script>

<template>
  <div
    v-if="message"
    :class="[
      'p-3 rounded-lg text-sm mb-4 font-medium',
      type === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-600 border border-green-200'
    ]"
  >
    {{ message }}
  </div>
</template>