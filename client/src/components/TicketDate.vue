<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ value?: string }>();
const date = computed(() => props.value ? new Date(props.value) : null);
const day = computed(() => date.value && Number.isFinite(date.value.getTime())
  ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(date.value) : '—');
const month = computed(() => date.value && Number.isFinite(date.value.getTime())
  ? new Intl.DateTimeFormat('vi-VN', { month: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(date.value) : '—');
</script>

<template>
  <div class="flex min-w-12 flex-col items-center rounded-md bg-background px-2 py-1.5 text-foreground">
    <span class="text-xl font-extrabold tabular-nums">{{ day }}</span>
    <span class="text-[10px] font-semibold uppercase tracking-widest">Tháng {{ month }}</span>
  </div>
</template>
