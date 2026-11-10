<script setup lang="ts">
import { computed } from 'vue';
import { Clock, CircleCheck, CircleX, TimerOff } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';

const props = defineProps<{ status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' }>();
const statuses = {
  PENDING: { variant: 'warning', icon: Clock, label: 'Chờ thanh toán' },
  CONFIRMED: { variant: 'success', icon: CircleCheck, label: 'Đã xác nhận' },
  CANCELLED: { variant: 'danger', icon: CircleX, label: 'Đã huỷ' },
  EXPIRED: { variant: 'muted', icon: TimerOff, label: 'Hết hạn' },
} as const;
const current = computed(() => statuses[props.status]);
</script>

<template>
  <Badge :variant="current.variant" class="h-auto px-2.5 py-1 [&>svg]:size-3.5!">
    <component :is="current.icon" :size="14" aria-hidden="true" />
    {{ current.label }}
  </Badge>
</template>
