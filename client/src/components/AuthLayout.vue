<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import apiClient from '@/api/axios';
import type { EventItem, EventListResponse } from '@/stores/event';
import TicketDate from '@/components/TicketDate.vue';
import { formatPrice } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/media';

defineProps<{ title: string; description: string }>();
const event = ref<EventItem>();
const imageLoaded = ref(false);
const imageFailed = ref(false);
const controller = new AbortController();
const price = computed(() => {
  const prices = (event.value?.ticketTypes ?? []).map(ticket => Number(ticket.price))
    .filter(value => Number.isFinite(value) && value >= 0);
  const min = prices.length ? Math.min(...prices) : undefined;
  return min === 0 ? 'Miễn phí' : `Từ ${formatPrice(min)}`;
});
onMounted(async () => {
  try {
    const { data } = await apiClient.get<EventListResponse>('/events', {
      params: { page: 1, limit: 6, status: 'upcoming' },
      signal: controller.signal,
    });
    if (!controller.signal.aborted) event.value = data.data.find(item => item.bannerUrl) ?? data.data[0];
  } catch {
    // Giữ nền đen và nội dung khi không tải được sự kiện.
  }
});
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="flex min-h-screen flex-col bg-surface lg:flex-row">
    <aside class="relative flex h-48 shrink-0 flex-col justify-between overflow-hidden bg-primary p-6 text-primary-foreground sm:h-56 lg:h-auto lg:w-1/2 lg:p-10 xl:p-14">
      <img
        v-if="event?.bannerUrl && !imageFailed"
        :src="resolveMediaUrl(event.bannerUrl) ?? undefined"
        alt=""
        class="absolute inset-0 h-full w-full object-cover"
        :class="imageLoaded ? 'opacity-100' : 'opacity-0'"
        @load="imageLoaded = true"
        @error="imageFailed = true"
      />
      <div v-if="imageLoaded && !imageFailed" class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
      <RouterLink to="/" class="relative self-start text-xl font-extrabold tracking-tight">EventHub</RouterLink>
      <div class="relative space-y-6 lg:mt-16">
        <p class="text-2xl font-extrabold tracking-tight text-white sm:text-3xl xl:text-4xl">Mỗi tấm vé, một trải nghiệm.</p>
        <RouterLink v-if="event" :data-tone="event.category || undefined" :to="`/events/${event.slug ?? event.id}`" class="hidden w-full max-w-md items-center overflow-hidden rounded-lg lg:flex bg-background text-foreground">
          <div class="flex min-w-0 flex-1 items-center gap-3 p-4">
            <TicketDate :value="event.startTime" :category="event.category" class="shrink-0" />
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-widest text-tone-ink">Sắp diễn ra</p>
              <p class="mt-1 line-clamp-1 font-semibold">{{ event.title }}</p>
              <p class="mt-1 line-clamp-1 text-sm text-muted-foreground">{{ event.location }}</p>
            </div>
          </div>
          <div class="relative flex max-w-[40%] self-stretch items-center border-l border-dashed border-border px-4">
            <span aria-hidden="true" class="absolute -left-2 -top-2 size-4 rounded-full border border-border bg-primary" />
            <p class="text-sm font-semibold tabular-nums text-brand">{{ price }}</p>
            <span aria-hidden="true" class="absolute -bottom-2 -left-2 size-4 rounded-full border border-border bg-primary" />
          </div>
        </RouterLink>
      </div>
    </aside>
    <main class="flex min-w-0 flex-1 justify-center px-6 py-10 lg:items-center lg:py-12">
      <div class="w-full max-w-sm">
        <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">{{ title }}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{{ description }}</p>
        <slot />
      </div>
    </main>
  </div>
</template>
