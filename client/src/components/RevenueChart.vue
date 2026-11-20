<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { DailySales } from '@/stores/dashboard';
import { formatPrice } from '@/utils/format';

/**
 * Cột doanh thu theo ngày, vẽ bằng SVG (không thêm thư viện biểu đồ).
 * Một chuỗi số liệu nên không có chú giải; tiêu đề khu vực nói rõ đang vẽ gì.
 * Rê chuột, chạm hoặc dùng phím mũi tên để xem từng ngày; bảng số liệu ở
 * `<details>` bên dưới cho người dùng trình đọc màn hình.
 */
const props = defineProps<{ daily: DailySales[] }>();

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

const container = ref<HTMLElement | null>(null);
const width = ref(640);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!container.value) return;
  width.value = container.value.clientWidth || 640;
  observer = new ResizeObserver(([entry]) => { if (entry) width.value = Math.max(280, entry.contentRect.width); });
  observer.observe(container.value);
});
onBeforeUnmount(() => observer?.disconnect());

const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

/** Mức trục đẹp: 1, 2, 5 × 10^k, 4 khoảng. */
const ticks = computed(() => {
  const max = Math.max(0, ...props.daily.map((d) => d.revenue));
  if (max === 0) return [0, 1, 2, 3, 4].map((i) => i * 25000);
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return [0, 1, 2, 3, 4].map((i) => i * step);
});
const yMax = computed(() => ticks.value[ticks.value.length - 1] || 1);

const innerW = computed(() => width.value - PAD.left - PAD.right);
const innerH = HEIGHT - PAD.top - PAD.bottom;
const band = computed(() => innerW.value / Math.max(1, props.daily.length));
// Cột mảnh: tối đa 24px, chừa khe 2px giữa hai cột cạnh nhau.
const barW = computed(() => Math.max(1, Math.min(24, band.value - 2)));

const y = (value: number) => PAD.top + innerH - (value / yMax.value) * innerH;
const xCenter = (i: number) => PAD.left + band.value * (i + 0.5);

/** Cột bo 4px ở đầu, vuông ở chân. */
function barPath(i: number, value: number) {
  const h = (value / yMax.value) * innerH;
  if (h <= 0) return '';
  const w = barW.value;
  const r = Math.min(4, w / 2, h);
  const x = xCenter(i) - w / 2;
  const base = PAD.top + innerH;
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const longDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

// Nhãn trục ngang thưa: khoảng 6 nhãn, luôn có ngày cuối.
const xLabels = computed(() => {
  const n = props.daily.length;
  const step = Math.max(1, Math.ceil(n / 6));
  return props.daily
    .map((d, i) => ({ i, label: shortDate(d.date) }))
    .filter(({ i }) => (n - 1 - i) % step === 0);
});

const active = ref<number | null>(null);
const activeDay = computed(() => (active.value === null ? null : props.daily[active.value] ?? null));
const tooltipLeft = computed(() => {
  if (active.value === null) return 0;
  return Math.min(Math.max(xCenter(active.value), 90), width.value - 90);
});

function onPointer(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const x = event.clientX - rect.left - PAD.left;
  const index = Math.floor(x / band.value);
  active.value = index >= 0 && index < props.daily.length ? index : null;
}

function onKey(event: KeyboardEvent) {
  const n = props.daily.length;
  if (!n) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const start = active.value ?? (event.key === 'ArrowRight' ? -1 : n);
    active.value = Math.min(n - 1, Math.max(0, start + (event.key === 'ArrowRight' ? 1 : -1)));
  } else if (event.key === 'Home') {
    event.preventDefault();
    active.value = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    active.value = n - 1;
  } else if (event.key === 'Escape') {
    active.value = null;
  }
}

const total = computed(() => props.daily.reduce((sum, d) => sum + d.revenue, 0));
const best = computed(() => props.daily.reduce<DailySales | null>((top, d) => (d.revenue > (top?.revenue ?? 0) ? d : top), null));
const summary = computed(() => {
  if (!props.daily.length) return 'Chưa có số liệu.';
  const range = `${longDate(props.daily[0]!.date)} đến ${longDate(props.daily[props.daily.length - 1]!.date)}`;
  return best.value
    ? `Doanh thu theo ngày từ ${range}: tổng ${formatPrice(total.value)}, cao nhất ${formatPrice(best.value.revenue)} ngày ${longDate(best.value.date)}.`
    : `Doanh thu theo ngày từ ${range}: chưa bán được vé nào.`;
});
</script>

<template>
  <div class="space-y-3">
    <div
      ref="container"
      class="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabindex="0"
      role="group"
      :aria-label="`${summary} Dùng phím mũi tên trái phải để xem từng ngày.`"
      @keydown="onKey"
      @blur="active = null"
    >
      <svg
        :width="width"
        :height="HEIGHT"
        :viewBox="`0 0 ${width} ${HEIGHT}`"
        class="block max-w-full touch-pan-y select-none"
        aria-hidden="true"
        @pointermove="onPointer"
        @pointerdown="onPointer"
        @pointerleave="active = null"
      >
        <!-- Lưới ngang mảnh và nhãn trục dọc -->
        <g v-for="tick in ticks" :key="tick">
          <line :x1="PAD.left" :x2="width - PAD.right" :y1="y(tick)" :y2="y(tick)" class="stroke-border" stroke-width="1" shape-rendering="crispEdges" />
          <text :x="PAD.left - 8" :y="y(tick)" text-anchor="end" dominant-baseline="middle" class="fill-muted-foreground text-[11px] tabular-nums">{{ tick === 0 ? '0' : compact.format(tick) }}</text>
        </g>

        <!-- Vùng đang chọn: nền nhạt cả cột để dễ thấy ngày nào -->
        <rect
          v-if="active !== null"
          :x="PAD.left + band * active"
          :y="PAD.top"
          :width="band"
          :height="innerH"
          class="fill-muted"
        />

        <path
          v-for="(day, i) in daily"
          :key="day.date"
          :d="barPath(i, day.revenue)"
          class="fill-chart-2 transition-opacity"
          :class="active !== null && active !== i ? 'opacity-40' : ''"
        />

        <text
          v-for="tick in xLabels"
          :key="tick.i"
          :x="xCenter(tick.i)"
          :y="HEIGHT - 8"
          text-anchor="middle"
          class="fill-muted-foreground text-[11px] tabular-nums"
        >{{ tick.label }}</text>
      </svg>

      <div
        v-if="activeDay"
        class="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
        :style="{ left: `${tooltipLeft}px` }"
        role="status"
      >
        <p class="font-semibold">{{ longDate(activeDay.date) }}</p>
        <p class="mt-1 flex justify-between gap-2"><span class="text-muted-foreground">Doanh thu</span><span class="font-semibold tabular-nums">{{ formatPrice(activeDay.revenue) }}</span></p>
        <p class="flex justify-between gap-2"><span class="text-muted-foreground">Đơn</span><span class="tabular-nums">{{ activeDay.orders }}</span></p>
        <p class="flex justify-between gap-2"><span class="text-muted-foreground">Vé</span><span class="tabular-nums">{{ activeDay.tickets }}</span></p>
      </div>
    </div>

    <details class="text-sm">
      <summary class="cursor-pointer text-muted-foreground hover:text-foreground">Xem dạng bảng</summary>
      <div class="mt-2 max-h-72 overflow-auto rounded-md border border-border">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">Doanh thu theo ngày</caption>
          <thead class="sticky top-0 bg-muted">
            <tr>
              <th scope="col" class="px-3 py-2 font-medium">Ngày</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Doanh thu</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Đơn</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Vé</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in [...daily].reverse()" :key="day.date" class="border-t border-border">
              <td class="px-3 py-1.5 tabular-nums">{{ longDate(day.date) }}</td>
              <td class="px-3 py-1.5 text-right tabular-nums">{{ formatPrice(day.revenue) }}</td>
              <td class="px-3 py-1.5 text-right tabular-nums">{{ day.orders }}</td>
              <td class="px-3 py-1.5 text-right tabular-nums">{{ day.tickets }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
