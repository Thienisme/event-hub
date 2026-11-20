<script setup lang="ts">
import { computed } from 'vue';
import { categoryLabel } from '@/utils/categories';
import { APP_TIMEZONE, formatEventDateShort, formatPrice, getEventPhase } from '@/utils/format';
// Dùng chung type với store để tránh lệch kiểu (vd description có thể là null từ Prisma)
import type { EventItem } from '../stores/event';
import EventBanner from './EventBanner.vue';

const props = defineProps<{
  event: EventItem;
}>();

// Tính giá vé thấp nhất để hiển thị kiểu "Từ xxx.xxx VNĐ"
const minPrice = computed(() => {
  if (!props.event.ticketTypes || props.event.ticketTypes.length === 0) return null;
  const prices = props.event.ticketTypes.map((t) => Number(t.price));
  return Math.min(...prices);
});

const phase = computed(() => getEventPhase(props.event.startTime, props.event.endTime));
const inventory = computed(() => (props.event.ticketTypes ?? []).reduce(
  (sum, ticket) => ({ total: sum.total + ticket.totalQuantity, available: sum.available + ticket.availableQuantity }),
  { total: 0, available: 0 }
));
const soldOut = computed(() => !!props.event.ticketTypes?.length && inventory.value.available === 0);
const status = computed(() => {
  if (phase.value === 'ended') return { label: 'Đã kết thúc', variant: 'muted' as const };
  if (soldOut.value) return { label: 'Hết vé', variant: 'danger' as const };
  if (inventory.value.available > 0 && inventory.value.available <= inventory.value.total * 0.1)
    return { label: 'Sắp hết vé', variant: 'brand' as const };
  if (phase.value === 'ongoing') return { label: 'Đang diễn ra', variant: 'success' as const };
  return null;
});
const calendar = computed(() => {
  const date = new Date(props.event.startTime);
  if (Number.isNaN(date.getTime())) return { day: '—', month: '—', weekday: '' };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: '2-digit', month: '2-digit' }).formatToParts(date);
  // "Th 6" -> "T6" để dòng cuống vé không lặp chữ "TH" với tháng.
  const weekday = new Intl.DateTimeFormat('vi-VN', { timeZone: APP_TIMEZONE, weekday: 'short' }).format(date).replace(/^Th\s*/, 'T');
  return { day: parts.find(part => part.type === 'day')?.value, month: parts.find(part => part.type === 'month')?.value, weekday };
});
const when = computed(() => formatEventDateShort(props.event.startTime, props.event.endTime));
// Thành phố = đoạn cuối của địa chỉ ("..., Đà Nẵng"); in trên dòng nhãn của vé.
const city = computed(() => props.event.location?.split(',').pop()?.trim() ?? '');
// Số seri trang trí trên cuống vé, lấy từ id để mỗi sự kiện cố định một số.
const serial = computed(() => String(parseInt(props.event.id.replace(/[^0-9a-f]/gi, '').slice(-6), 16) % 1000000).padStart(6, '0'));
</script>

<template>
  <!-- Thẻ sự kiện dạng vé giấy: thân vé (ảnh, tên, địa điểm) + đường xé có khía + cuống vé màu danh mục. -->
  <router-link :to="`/events/${event.slug ?? event.id}`" :data-tone="event.category || undefined" class="group block h-full min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
    <article class="paper ticket-notch flex h-full flex-col transition-transform duration-200 motion-safe:group-hover:-translate-y-1" style="--cut: calc(100% - 4.5rem)">
      <div class="relative aspect-video overflow-hidden bg-muted">
        <EventBanner :src="event.bannerUrl" :alt="event.title" class="[&>*]:transition-transform [&>*]:duration-300 motion-safe:[&>*]:group-hover:scale-[1.03] motion-reduce:[&>*]:transform-none motion-reduce:[&>*]:transition-none [&>div]:bg-none [&>div]:bg-muted [&>div>span]:sr-only" />
        <span
          v-if="status"
          class="absolute right-3 top-3 max-w-[calc(100%-1.5rem)] -rotate-6 rounded-sm border-2 bg-paper/95 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-widest"
          :class="{
            'border-stamp text-stamp': status.variant === 'brand' || status.variant === 'danger',
            'border-success text-success': status.variant === 'success',
            'border-muted-foreground text-muted-foreground': status.variant === 'muted',
          }"
        >{{ status.label }}</span>
      </div>
      <div class="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-3">
        <p class="flex min-w-0 items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span class="size-2.5 shrink-0 bg-tone" aria-hidden="true" />
          <span class="truncate"><span>{{ event.category ? categoryLabel(event.category) : 'Sự kiện' }}</span><span v-if="city"> · {{ city }}</span></span>
        </p>
        <h3 class="line-clamp-2 break-words text-xl font-extrabold leading-tight underline-offset-4 group-hover:underline">{{ event.title }}</h3>
        <p class="line-clamp-1 text-sm text-muted-foreground">{{ event.location }} · {{ when }}</p>
      </div>
      <!-- Cuống vé: ngày in to trên nền màu danh mục, giá và mã vạch. -->
      <div class="flex h-[4.5rem] shrink-0 items-stretch border-t-2 border-dashed border-border">
        <div class="flex min-w-[5.25rem] flex-col justify-center bg-tone px-3 text-tone-foreground" aria-hidden="true">
          <span class="text-3xl font-extrabold leading-none tabular-nums [font-stretch:75%]">{{ calendar.day }}</span>
          <span class="mt-1 font-mono text-[11px] font-bold uppercase">{{ calendar.weekday }} · Th{{ calendar.month }}</span>
        </div>
        <div class="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3">
          <p class="truncate font-mono text-sm font-bold tabular-nums">
            <template v-if="minPrice === null"><span class="font-medium text-muted-foreground">Chưa mở bán</span></template>
            <template v-else><span v-if="minPrice !== 0" class="mr-1 font-medium text-muted-foreground">Từ</span><span :class="minPrice === 0 ? 'text-paper-foreground' : 'text-brand'">{{ minPrice === 0 ? 'Miễn phí' : formatPrice(minPrice) }}</span></template>
          </p>
          <div class="flex items-center gap-2 text-paper-foreground/80" aria-hidden="true">
            <span class="barcode h-4 flex-1" />
            <span class="font-mono text-[10px] tracking-widest">№{{ serial }}</span>
          </div>
        </div>
      </div>
    </article>
  </router-link>
</template>
