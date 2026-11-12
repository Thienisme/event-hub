<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from '@lucide/vue';
import apiClient from '@/api/axios';
import type { EventItem, EventListResponse } from '@/stores/event';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryLabel } from '@/utils/categories';
import { formatEventDateShort, formatPrice } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/media';

const events = ref<EventItem[]>([]);
const loading = ref(true);
const activeIndex = ref(0);
const failedImages = ref(new Set<string>());
const controller = new AbortController();
let interval: ReturnType<typeof setInterval> | undefined;
let motionQuery: MediaQueryList | undefined;
let hovered = false;
let focused = false;

function stopAutoplay() {
  if (interval !== undefined) clearInterval(interval);
  interval = undefined;
}

function syncAutoplay() {
  stopAutoplay();
  if (events.value.length > 1 && !hovered && !focused && !motionQuery?.matches) {
    interval = setInterval(() => {
      activeIndex.value = (activeIndex.value + 1) % events.value.length;
    }, 6000);
  }
}

function selectSlide(index: number) {
  activeIndex.value = (index + events.value.length) % events.value.length;
  syncAutoplay();
}

function setHovered(value: boolean) {
  hovered = value;
  syncAutoplay();
}

function onFocusIn() {
  focused = true;
  syncAutoplay();
}

function onFocusOut(event: FocusEvent) {
  focused = event.relatedTarget instanceof Node
    && (event.currentTarget as HTMLElement).contains(event.relatedTarget);
  syncAutoplay();
}

function priceLabel(event: EventItem): string {
  const prices = (event.ticketTypes ?? [])
    .map(ticket => Number(ticket.price))
    .filter(price => Number.isFinite(price) && price >= 0);
  if (!prices.length) return `Từ ${formatPrice(undefined)}`;
  const min = Math.min(...prices);
  return min === 0 ? 'Miễn phí' : `Từ ${formatPrice(min)}`;
}

onMounted(async () => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', syncAutoplay);
  try {
    const response = await apiClient.get<EventListResponse>('/events', {
      params: { page: 1, limit: 6, status: 'upcoming' },
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const items = response.data.data;
    const withBanners = items.filter(event => event.bannerUrl);
    events.value = (withBanners.length ? withBanners : items).slice(0, 3);
    syncAutoplay();
  } catch {
    events.value = [];
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  controller.abort();
  stopAutoplay();
  motionQuery?.removeEventListener('change', syncAutoplay);
});
</script>

<template>
  <section
    v-if="loading || events.length"
    aria-roledescription="carousel"
    aria-label="Sự kiện nổi bật"
    :aria-busy="loading"
    class="relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-primary text-primary-foreground sm:aspect-[16/9] lg:aspect-[21/9]"
    @mouseenter="setHovered(true)"
    @mouseleave="setHovered(false)"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <Skeleton v-if="loading" class="absolute inset-0 h-full w-full rounded-lg" />
    <template v-else>
      <article
        v-for="(event, index) in events"
        :key="event.id"
        role="group"
        aria-roledescription="slide"
        :aria-label="`${index + 1} / ${events.length}`"
        :aria-hidden="index !== activeIndex"
        :inert="index !== activeIndex"
        class="absolute inset-0 bg-primary transition-opacity duration-500 motion-reduce:transition-none"
        :class="index === activeIndex ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'"
      >
        <img
          v-if="event.bannerUrl && !failedImages.has(event.id)"
          :src="resolveMediaUrl(event.bannerUrl) ?? undefined"
          alt=""
          class="absolute inset-0 h-full w-full object-cover"
          @error="failedImages.add(event.id)"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div
          class="absolute inset-x-0 bottom-0 max-w-2xl space-y-4 p-6 sm:p-10"
          :class="events.length > 1 ? 'pb-24 sm:pb-24' : ''"
        >
          <p class="text-xs font-semibold uppercase tracking-widest text-white/80">
            Nổi bật · {{ categoryLabel(event.category ?? 'OTHER') }}
          </p>
          <h2 class="line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
            {{ event.title }}
          </h2>
          <div class="flex flex-col gap-2 text-sm text-white/85">
            <p class="flex items-start gap-2">
              <CalendarDays class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{{ formatEventDateShort(event.startTime, event.endTime) }}</span>
            </p>
            <p class="flex items-start gap-2">
              <MapPin class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span class="line-clamp-2">{{ event.location }}</span>
            </p>
          </div>
          <p class="font-semibold tabular-nums text-white">{{ priceLabel(event) }}</p>
          <Button as-child class="bg-brand text-brand-foreground hover:bg-brand/90 motion-reduce:transform-none motion-reduce:transition-none">
            <RouterLink :to="`/events/${event.slug ?? event.id}`">Đặt vé ngay</RouterLink>
          </Button>
        </div>
      </article>

      <template v-if="events.length > 1">
        <div class="absolute bottom-6 left-6 z-20 flex items-center gap-2 sm:bottom-10 sm:left-10">
          <button
            v-for="(_, index) in events"
            :key="index"
            type="button"
            :aria-label="`Xem sự kiện ${index + 1}`"
            :aria-current="index === activeIndex ? 'true' : undefined"
            class="flex h-9 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            @click="selectSlide(index)"
          >
            <span
              class="h-2 rounded-full"
              :class="index === activeIndex ? 'w-6 bg-white' : 'w-2 bg-white/50'"
            />
          </button>
        </div>
        <div class="absolute bottom-6 right-6 z-20 flex gap-2 sm:bottom-10 sm:right-10">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Sự kiện trước"
            class="bg-white/90 text-foreground shadow-none motion-reduce:transform-none motion-reduce:transition-none"
            @click="selectSlide(activeIndex - 1)"
          >
            <ChevronLeft class="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Sự kiện tiếp theo"
            class="bg-white/90 text-foreground shadow-none motion-reduce:transform-none motion-reduce:transition-none"
            @click="selectSlide(activeIndex + 1)"
          >
            <ChevronRight class="size-4" aria-hidden="true" />
          </Button>
        </div>
      </template>
    </template>
  </section>
</template>
