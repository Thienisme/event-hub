<script setup lang="ts">
import { computed } from 'vue';
import { categoryLabel } from '@/utils/categories';
import { APP_TIMEZONE, formatEventDateShort, formatPrice, getEventPhase } from '@/utils/format';
import { CalendarDays, MapPin } from '@lucide/vue';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    return { label: 'Sắp hết vé', variant: 'warning' as const };
  if (phase.value === 'ongoing') return { label: 'Đang diễn ra', variant: 'success' as const };
  return null;
});
const calendar = computed(() => {
  const date = new Date(props.event.startTime);
  if (Number.isNaN(date.getTime())) return { day: '—', month: '—' };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: '2-digit', month: '2-digit' }).formatToParts(date);
  return { day: parts.find(part => part.type === 'day')?.value, month: parts.find(part => part.type === 'month')?.value };
});
</script>

<template>
  <router-link :to="`/events/${event.id}`" class="group block h-full min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
    <Card class="shadow-none ring-0 border border-border bg-background h-full gap-0 rounded-lg py-0 transition-colors">
      <div class="relative aspect-video overflow-hidden bg-surface">
        <EventBanner :src="event.bannerUrl" :alt="event.title" class="[&>*]:transition-transform [&>*]:duration-200 motion-safe:[&>*]:group-hover:scale-[1.02] motion-reduce:[&>*]:transform-none motion-reduce:[&>*]:transition-none [&>div]:bg-none [&>div]:bg-muted [&>div>span]:text-muted-foreground" />
        <div aria-hidden="true" class="absolute left-3 top-3 w-12 overflow-hidden rounded-lg bg-background text-center text-foreground">
          <div class="bg-primary/10 py-1 text-[10px] font-semibold text-primary">TH {{ calendar.month }}</div>
          <div class="py-1 text-2xl font-semibold tabular-nums">{{ calendar.day }}</div>
        </div>
        <Badge v-if="status" :variant="status.variant" class="absolute right-3 top-3 max-w-[calc(100%-5rem)]">{{ status.label }}</Badge>
      </div>
      <div class="flex flex-1 flex-col p-4">
        <Badge v-if="event.category" variant="outline" class="mb-2 self-start text-xs font-semibold uppercase tracking-widest text-muted-foreground">{{ categoryLabel(event.category) }}</Badge>
        <h3 class="mb-3 line-clamp-2 min-h-12 break-words text-base font-semibold tracking-tight transition-colors group-hover:text-primary">{{ event.title }}</h3>
        <p class="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <CalendarDays class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{{ formatEventDateShort(event.startTime, event.endTime) }}</span>
        </p>
        <p class="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <MapPin class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{{ event.location }}</span>
        </p>
        <div class="mt-auto pt-5">
          <div class="flex items-center justify-between gap-2 border-t pt-4">
            <div class="min-w-0">
              <span v-if="minPrice !== null && minPrice !== 0" class="block text-xs text-muted-foreground">Từ</span>
              <span class="break-words font-semibold text-brand tabular-nums">{{ minPrice === null ? 'Chưa mở bán' : minPrice === 0 ? 'Miễn phí' : formatPrice(minPrice) }}</span>
            </div>
            <Button as="span" size="sm" class="shrink-0" :class="phase === 'ended' || soldOut ? '' : 'bg-brand text-brand-foreground hover:bg-brand/90'">{{ phase === 'ended' || soldOut ? 'Xem' : 'Đặt vé' }}</Button>
          </div>
        </div>
      </div>
    </Card>
  </router-link>
</template>
