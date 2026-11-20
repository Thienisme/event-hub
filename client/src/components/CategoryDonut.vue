<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CategorySales } from '@/stores/dashboard';
import { categoryLabel } from '@/utils/categories';
import { formatPrice } from '@/utils/format';

/**
 * Biểu đồ vòng doanh thu theo danh mục, vẽ bằng SVG (không thêm thư viện).
 * Màu từng đoạn lấy từ token danh mục (`data-tone` + `stroke-tone` / `bg-tone`);
 * chữ chú giải giữ màu trung tính để dễ đọc.
 */
const props = defineProps<{
  items: CategorySales[];
}>();

const SIZE = 164;
const CENTER = SIZE / 2;
const STROKE = 22;
const RADIUS = 68;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

const revenueItems = computed(() => props.items.filter((item) => item.revenue > 0));
const totalRevenue = computed(() => revenueItems.value.reduce((sum, item) => sum + item.revenue, 0));

const formatPercent = (share: number) => {
  const pct = share * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
};

const segments = computed(() => {
  const list = revenueItems.value;
  const total = totalRevenue.value;
  if (!list.length || total <= 0) return [];

  const gap = list.length > 1 ? GAP : 0;
  let offset = 0;

  return list.map((item) => {
    const share = item.revenue / total;
    const rawLen = share * CIRCUMFERENCE;
    const dash = gap > 0 ? Math.max(1, rawLen - gap) : CIRCUMFERENCE;
    const start = offset + gap / 2;
    offset += rawLen;

    return {
      ...item,
      label: categoryLabel(item.category),
      percentText: formatPercent(share),
      dash,
      gapLen: Math.max(0, CIRCUMFERENCE - dash),
      dashOffset: -start,
    };
  });
});

const activeCategory = ref<string | null>(null);

const ariaSummary = computed(() => {
  if (!segments.value.length) return 'Chưa có doanh thu theo danh mục.';
  const parts = segments.value.map((seg) => `${seg.label} ${seg.percentText} (${formatPrice(seg.revenue)})`).join(', ');
  return `Doanh thu theo danh mục: tổng ${formatPrice(totalRevenue.value)}, gồm ${parts}.`;
});
</script>

<template>
  <p v-if="segments.length === 0" class="text-sm text-muted-foreground">Chưa có doanh thu.</p>
  <div v-else class="@container">
    <div class="flex flex-col items-center gap-5 @sm:flex-row @sm:items-center">
      <div class="relative shrink-0" :style="{ width: `${SIZE}px`, height: `${SIZE}px` }">
        <svg
          :width="SIZE"
          :height="SIZE"
          :viewBox="`0 0 ${SIZE} ${SIZE}`"
          role="img"
          :aria-label="ariaSummary"
          class="block select-none"
        >
          <g :transform="`rotate(-90 ${CENTER} ${CENTER})`">
            <g
              v-for="seg in segments"
              :key="seg.category"
              :data-tone="seg.category"
              class="cursor-pointer"
              @mouseenter="activeCategory = seg.category"
              @mouseleave="activeCategory = null"
            >
              <circle
                :cx="CENTER"
                :cy="CENTER"
                :r="RADIUS"
                fill="none"
                :stroke-width="activeCategory === seg.category ? STROKE + 3 : STROKE"
                :stroke-dasharray="`${seg.dash} ${seg.gapLen}`"
                :stroke-dashoffset="seg.dashOffset"
                class="stroke-tone transition-opacity duration-200 motion-safe:transition-[opacity,stroke-width]"
                :class="activeCategory !== null && activeCategory !== seg.category ? 'opacity-40' : ''"
              />
            </g>
          </g>
        </svg>

        <div
          class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center"
          aria-hidden="true"
        >
          <span class="font-mono text-lg font-bold leading-tight tabular-nums text-foreground">
            {{ compact.format(totalRevenue) }}
          </span>
          <span class="mt-0.5 text-[11px] text-muted-foreground">doanh thu</span>
        </div>
      </div>

      <ul class="w-full min-w-0 flex-1 space-y-1">
        <li
          v-for="seg in segments"
          :key="seg.category"
          :data-tone="seg.category"
          tabindex="0"
          class="flex items-center justify-between gap-3 rounded-sm px-1.5 py-1 text-sm outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-ring"
          :class="activeCategory !== null && activeCategory !== seg.category ? 'opacity-40' : ''"
          @mouseenter="activeCategory = seg.category"
          @mouseleave="activeCategory = null"
          @focus="activeCategory = seg.category"
          @blur="activeCategory = null"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="size-2.5 shrink-0 bg-tone" aria-hidden="true" />
            <span class="truncate text-foreground">{{ seg.label }}</span>
          </span>
          <span class="flex shrink-0 items-baseline gap-2 font-mono text-xs tabular-nums">
            <span class="font-medium text-foreground">{{ formatPrice(seg.revenue) }}</span>
            <span class="w-9 text-right text-muted-foreground">{{ seg.percentText }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
