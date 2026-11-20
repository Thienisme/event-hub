<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { CalendarDays, MapPin, ScanLine } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataState from '@/components/DataState.vue';
import { useStaffStore } from '@/stores/staff';
import type { CheckInEvent } from '@/stores/staff';
import { useAuthStore } from '@/stores/auth';
import { formatEventDateShort, getEventPhase } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/media';

/** Các sự kiện tài khoản này được gán làm nhân viên soát vé. */
const staffStore = useStaffStore();
const authStore = useAuthStore();

onMounted(async () => {
  await staffStore.fetchMyEvents();
  // Đồng bộ mục "Soát vé" trong menu nếu vừa bị gỡ hoặc vừa được thêm.
  if (!staffStore.myError) authStore.isCheckInStaff = staffStore.myEvents.length > 0;
});

const PHASE_LABEL = { upcoming: 'Sắp diễn ra', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc' } as const;
const phase = (event: CheckInEvent) => getEventPhase(event.startTime, event.endTime);

// Đang và sắp diễn ra lên trước; sự kiện đã kết thúc xuống cuối.
const events = computed(() => [...staffStore.myEvents].sort((a, b) => {
  const endedA = phase(a) === 'ended' ? 1 : 0;
  const endedB = phase(b) === 'ended' ? 1 : 0;
  return endedA - endedB || new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}));
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-4xl space-y-6">
      <header class="space-y-2">
        <p class="flex items-center gap-2 text-sm font-medium text-primary"><ScanLine class="size-4" aria-hidden="true" />Nhân viên soát vé</p>
        <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Sự kiện cần soát vé</h1>
        <p class="text-sm text-muted-foreground">Chọn sự kiện để mở máy quét mã QR ở cổng.</p>
      </header>

      <DataState
        :loading="staffStore.myLoading"
        :loaded="staffStore.myLoaded"
        :error="staffStore.myError"
        :empty="events.length === 0"
        empty-title="Bạn chưa được giao soát vé sự kiện nào"
        empty-description="Khi nhà tổ chức thêm email của bạn làm nhân viên soát vé, sự kiện sẽ hiện ở đây."
        @retry="staffStore.fetchMyEvents()"
      >
        <ul class="space-y-3">
          <li v-for="event in events" :key="event.id">
            <article class="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center">
              <img
                v-if="resolveMediaUrl(event.bannerUrl)"
                :src="resolveMediaUrl(event.bannerUrl)!"
                alt=""
                class="aspect-video w-full rounded-md object-cover sm:w-40"
                loading="lazy"
              />
              <div class="min-w-0 flex-1 space-y-1">
                <Badge variant="outline">{{ PHASE_LABEL[phase(event)] }}</Badge>
                <h2 class="break-words text-lg font-semibold">{{ event.title }}</h2>
                <p class="flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarDays class="size-4 shrink-0" aria-hidden="true" />{{ formatEventDateShort(event.startTime, event.endTime) }}</p>
                <p class="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin class="size-4 shrink-0" aria-hidden="true" /><span class="break-words">{{ event.location }}</span></p>
                <p class="text-xs text-muted-foreground">Nhà tổ chức: {{ event.organizerName }}</p>
              </div>
              <Button as-child :variant="phase(event) === 'ended' ? 'outline' : 'default'" class="sm:self-center">
                <router-link :to="{ name: 'CheckIn', params: { id: event.id } }" :aria-label="`Soát vé ${event.title}`">
                  <ScanLine class="size-4" aria-hidden="true" />Soát vé
                </router-link>
              </Button>
            </article>
          </li>
        </ul>
      </DataState>
    </div>
  </main>
</template>
