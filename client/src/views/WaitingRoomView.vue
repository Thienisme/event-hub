<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore, type EventItem } from '@/stores/event';
import { useQueueStore, type QueueStatus } from '@/stores/queue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import EventBanner from '@/components/EventBanner.vue';

const route = useRoute();
const router = useRouter();
const events = useEventStore();
const queue = useQueueStore();
const event = ref<EventItem | null>(null);
const state = ref<QueueStatus | null>(null);
const error = ref('');
const busy = ref(false);
const initialAhead = ref<number | null>(null);
const progress = computed(() => state.value?.state === 'WAITING' && initialAhead.value
  ? Math.max(0, Math.min(100, (1 - state.value.ahead / initialAhead.value) * 100)) : 0);
const estimate = computed(() => {
  if (state.value?.state !== 'WAITING') return '';
  const seconds = Math.max(0, state.value.estimatedWaitSeconds);
  return seconds < 60 ? 'dưới 1 phút' : `khoảng ${Math.ceil(seconds / 60)} phút`;
});
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let stopped = false;
let failures = 0;
let retryJoin = true;
function schedule(version: number) {
  clearTimeout(timer);
  if (stopped || version !== generation) return;
  const interval = document.visibilityState === 'hidden' ? 10000 : 3000;
  timer = setTimeout(() => void poll(version), Math.max(interval, failures ? Math.min(30000, 3000 * 2 ** failures) : 0));
}
async function poll(version: number) {
  if (busy.value || stopped || version !== generation) return;
  busy.value = true;
  try {
    if (!event.value) {
      const loaded = await events.fetchEventById(String(route.params.id));
      if (stopped || version !== generation) return;
      event.value = loaded;
    }
    if (stopped || version !== generation) return;
    if (!event.value) throw new Error('Không tìm thấy sự kiện.');
    const result = retryJoin ? await queue.join(event.value.id) : await queue.status(event.value.id);
    if (stopped || version !== generation) return;
    retryJoin = false;
    failures = 0;
    error.value = '';
    state.value = result;
    if (result.state === 'ACTIVE' || (result.state === 'NONE' && !result.queueEnabled)) {
      stopped = true;
      await router.replace({ name: 'EventDetail', params: { id: event.value.slug ?? event.value.id }, query: result.state === 'ACTIVE' ? { queuePass: '1' } : {} });
    } else if (result.state === 'WAITING') {
      initialAhead.value ??= result.ahead;
    }
  } catch (cause: any) {
    if (stopped || version !== generation) return;
    failures++;
    error.value = cause.response?.data?.message || 'Không thể kết nối phòng chờ. Đang tự động thử lại…';
  } finally {
    if (version === generation) {
      busy.value = false;
      if (failures || state.value?.state === 'WAITING') schedule(version);
    }
  }
}
function rejoin() {
  retryJoin = true;
  initialAhead.value = null;
  void poll(generation);
}
async function leave() {
  if (!event.value || busy.value) return;
  clearTimeout(timer);
  busy.value = true;
  try {
    await queue.leave(event.value.id);
    stopped = true;
    await router.push({ name: 'EventDetail', params: { id: event.value.slug ?? event.value.id } });
  } catch (cause: any) {
    error.value = cause.response?.data?.message || 'Không thể rời hàng, vui lòng thử lại!';
  } finally {
    busy.value = false;
    if (!stopped && state.value?.state === 'WAITING') schedule(generation);
  }
}
function visibilityChanged() {
  if (!busy.value && (failures || state.value?.state === 'WAITING')) schedule(generation);
}
document.addEventListener('visibilitychange', visibilityChanged);
watch(() => route.params.id, () => {
  generation++;
  clearTimeout(timer);
  stopped = false;
  busy.value = false;
  failures = 0;
  retryJoin = true;
  event.value = null;
  state.value = null;
  initialAhead.value = null;
  error.value = '';
  void poll(generation);
}, { immediate: true });
onUnmounted(() => {
  stopped = true;
  generation++;
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
    <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Phòng chờ ảo</p>
    <h1 class="break-words text-xl font-bold tracking-tight sm:text-2xl">{{ event?.title || 'Đang tải sự kiện…' }}</h1>
    <EventBanner v-if="event" :src="event.bannerUrl" :alt="event.title" class="aspect-[3/1] w-full rounded-lg object-cover" />
    <Card>
      <CardContent class="space-y-6 p-5 sm:p-6">
        <p v-if="error" role="status" class="text-sm text-danger">{{ error }}</p>
        <template v-if="state?.state === 'WAITING'">
          <div aria-live="polite" aria-atomic="true" class="space-y-3">
            <h2 class="text-xl font-semibold">Bạn đang ở vị trí <strong class="block pt-3 text-5xl font-extrabold tabular-nums">{{ state.position }}</strong></h2>
            <p>Còn {{ state.ahead }} người phía trước</p>
          </div>
          <div role="progressbar" aria-label="Tiến độ chờ đến lượt" :aria-valuenow="Math.round(progress)" :aria-valuemin="0" :aria-valuemax="100" class="h-2 overflow-hidden rounded-md bg-muted">
            <div class="h-full bg-primary" :style="{ width: `${progress}%` }" />
          </div>
          <p class="text-sm text-muted-foreground">Thời gian chờ ước tính: {{ estimate }}. Có {{ state.total }} người đang chờ.</p>
          <p class="text-sm leading-6">Giữ trang này mở, rời trang quá 30 giây bạn sẽ mất chỗ</p>
        </template>
        <div v-else-if="state?.state === 'NONE'" class="space-y-4">
          <p role="status">Bạn không còn trong hàng chờ. Có thể bạn đã rời trang quá lâu.</p>
          <Button :disabled="busy" @click="rejoin">Vào hàng lại</Button>
        </div>
        <p v-else role="status" class="text-sm text-muted-foreground">{{ state?.state === 'ACTIVE' ? 'Đến lượt bạn! Đang chuyển đến trang đặt vé…' : 'Đang vào phòng chờ…' }}</p>
        <Button variant="outline" class="w-full sm:w-auto" :disabled="busy || !event" @click="leave">Rời hàng</Button>
      </CardContent>
    </Card>
  </main>
</template>
