<script setup lang="ts">
import { computed, useSlots } from 'vue';
import type { Component } from 'vue';
import { TrendingDown, TrendingUp } from '@lucide/vue';

/**
 * Ô chỉ số cho bảng điều khiển: nhãn + icon trần, số liệu chính dạng mono,
 * chip biến động so với kỳ trước (tuỳ chọn), dòng phụ và hình nhỏ ở đáy (slot).
 */
const props = defineProps<{
  label: string;
  value: string;
  icon: Component;
  delta?: number | null;
  deltaCaption?: string;
  caption?: string;
}>();

const slots = useSlots();

const hasDelta = computed(() => props.delta !== undefined);

const deltaChipClass = computed(() => {
  if (props.delta === null || props.delta === undefined || props.delta === 0) {
    return 'bg-muted text-muted-foreground';
  }
  return props.delta > 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger';
});

const deltaText = computed(() => {
  if (props.delta === null || props.delta === undefined) return 'Mới';
  if (props.delta === 0) return '0%';
  // Tăng quá 999% (kỳ trước rất nhỏ) thì hiện gọn ">999%" thay vì số dài khó đọc.
  const abs = Math.abs(props.delta);
  const formatted = abs > 999 ? '>999' : abs.toLocaleString('vi-VN', { maximumFractionDigits: abs >= 100 ? 0 : 1 });
  return props.delta > 0 ? `+${formatted}%` : `-${formatted}%`;
});
</script>

<template>
  <div class="flex flex-col rounded-sm border border-border bg-background p-4">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <component :is="icon" class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="truncate">{{ label }}</span>
    </div>

    <p class="mt-2 font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">
      {{ value }}
    </p>

    <div v-if="hasDelta" class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span
        class="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums"
        :class="deltaChipClass"
      >
        <TrendingUp v-if="delta !== null && delta !== undefined && delta > 0" class="size-3 shrink-0" aria-hidden="true" />
        <TrendingDown v-else-if="delta !== null && delta !== undefined && delta < 0" class="size-3 shrink-0" aria-hidden="true" />
        {{ deltaText }}
      </span>
      <span v-if="deltaCaption" class="text-muted-foreground">{{ deltaCaption }}</span>
    </div>

    <p v-if="slots.caption || caption" class="mt-2 text-xs text-muted-foreground tabular-nums">
      <slot name="caption">{{ caption }}</slot>
    </p>

    <div v-if="slots.default" class="mt-auto pt-3">
      <slot />
    </div>
  </div>
</template>
