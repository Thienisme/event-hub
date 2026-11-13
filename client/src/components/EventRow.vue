<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import EventCard from './EventCard.vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { EventItem } from '@/stores/event';
const props = defineProps<{ title: string; events: EventItem[]; loading?: boolean; showAll?: boolean }>();
defineEmits<{ viewAll: [] }>();
const track = ref<HTMLElement | null>(null);
const atStart = ref(true);
const atEnd = ref(true);
function update() {
  const el = track.value;
  if (!el) return;
  atStart.value = el.scrollLeft <= 1;
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
}
function scroll(direction: number) {
  track.value?.scrollBy({ left: direction * track.value.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(update);
  if (track.value) observer.observe(track.value);
  update();
});
watch(() => [props.events, props.loading], async () => {
  await nextTick();
  if (track.value) observer?.observe(track.value);
  update();
});
onUnmounted(() => observer?.disconnect());
</script>
<template>
  <!-- Một thẻ lẻ trông như trang trống: cần ít nhất 2 sự kiện mới hiện hàng. -->
  <section v-if="loading || events.length >= 2" class="min-w-0 space-y-5" :aria-label="title" :aria-busy="loading">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold tracking-tight sm:text-2xl">{{ title }}</h2>
      <div class="flex shrink-0 items-center gap-2">
        <Button v-if="showAll && !loading" variant="ghost" @click="$emit('viewAll')">Xem tất cả</Button>
        <button v-if="!atStart" type="button" :aria-label="`Cuộn ${title} sang trái`" class="hidden size-9 items-center justify-center rounded-full border border-border bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:flex" @click="scroll(-1)"><ChevronLeft class="size-4" /></button>
        <button v-if="!atEnd" type="button" :aria-label="`Cuộn ${title} sang phải`" class="hidden size-9 items-center justify-center rounded-full border border-border bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:flex" @click="scroll(1)"><ChevronRight class="size-4" /></button>
      </div>
    </div>
    <div ref="track" class="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" tabindex="0" :aria-label="`Danh sách ${title}`" @scroll="update">
      <template v-if="loading"><div v-for="n in 4" :key="n" class="w-[78%] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-background md:w-[280px]" aria-hidden="true"><Skeleton class="aspect-video rounded-none" /><div class="space-y-3 p-4"><Skeleton class="h-5 w-full" /><Skeleton class="h-4 w-2/3" /><Skeleton class="h-4 w-3/4" /><Skeleton class="h-8 w-1/2" /></div></div></template>
      <div v-for="event in loading ? [] : events" :key="event.id" class="w-[78%] shrink-0 snap-start md:w-[280px]"><EventCard :event="event" /></div>
    </div>
  </section>
</template>
