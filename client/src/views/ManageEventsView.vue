<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import EventBanner from '@/components/EventBanner.vue';
import { Plus, Search, CalendarDays, Eye, Pencil, Trash2, ScanLine, Percent, MoreHorizontal } from '@lucide/vue';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useManageStore } from '../stores/manage';
import type { ManagedEvent } from '../stores/manage';
import { useToastStore } from '../stores/toast';
import apiClient from '../api/axios';
import DataState from '../components/DataState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { APP_TIMEZONE, formatDateTime, formatPrice, getEventPhase } from '../utils/format';

const router = useRouter();
const manageStore = useManageStore();
const toastStore = useToastStore();

/** Sự kiện đang chờ xác nhận xoá. */
const pendingDelete = ref<ManagedEvent | null>(null);
const deleteBusy = ref(false);

const searchInput = ref(manageStore.search);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const handleSearchInput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    manageStore.search = searchInput.value;
    manageStore.page = 1;
    manageStore.reload();
  }, 400);
};

const changePage = (page: number) => {
  if (page < 1 || page > manageStore.totalPages) return;
  manageStore.page = page;
  manageStore.reload();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/** Tổng số vé đã bán của một sự kiện = tổng số vé trừ số còn lại. */
const soldTickets = (event: ManagedEvent) =>
  event.ticketTypes.reduce((sum, type) => sum + (type.totalQuantity - type.availableQuantity), 0);

const totalTickets = (event: ManagedEvent) =>
  event.ticketTypes.reduce((sum, type) => sum + type.totalQuantity, 0);

/** Giai đoạn sự kiện: sắp diễn ra / đang diễn ra / đã kết thúc. */
const PHASE_META = {
  upcoming: { label: 'Sắp diễn ra', variant: 'info' as const },
  ongoing: { label: 'Đang diễn ra', variant: 'success' as const },
  ended: { label: 'Đã kết thúc', variant: 'muted' as const },
};

const phaseOf = (event: ManagedEvent) => getEventPhase(event.startTime, event.endTime);

/** Ô ngày kiểu tờ lịch (ngày + tháng) theo giờ Việt Nam. */
const calendarOf = (event: ManagedEvent) => {
  const date = new Date(event.startTime);
  if (Number.isNaN(date.getTime())) return { day: '—', month: '—' };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, day: '2-digit', month: '2-digit' }).formatToParts(date);
  return {
    day: parts.find((part) => part.type === 'day')?.value ?? '—',
    month: parts.find((part) => part.type === 'month')?.value ?? '—',
  };
};

/** Phần trăm vé đã bán, để tô đậm thanh tiến độ khi sắp cháy hàng. */
const soldPercent = (event: ManagedEvent) => {
  const total = totalTickets(event);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((soldTickets(event) / total) * 100));
};

const confirmDelete = async () => {
  if (!pendingDelete.value) return;

  deleteBusy.value = true;
  const event = pendingDelete.value;

  try {
    await apiClient.delete(`/events/${event.id}`);
    manageStore.removeEvent(event.id);
    toastStore.success('Đã xoá sự kiện!');
    pendingDelete.value = null;
  } catch (error: any) {
    toastStore.error(error.response?.data?.message || 'Xoá sự kiện thất bại!');
  } finally {
    deleteBusy.value = false;
  }
};

const deleteConfirmMessage = computed(() =>
  pendingDelete.value
    ? `Sự kiện "${pendingDelete.value.title}" sẽ bị xoá vĩnh viễn. Các vé đã bán sẽ không thể hoàn tiền tự động.`
    : ''
);

onMounted(() => {
  manageStore.reload();
});

onUnmounted(() => {
  clearTimeout(searchTimer);
  manageStore.cancelPending();
});
</script>

<template>
  <div class="min-h-screen bg-surface py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-6xl mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">Sự kiện của tôi</h1>
        </div>

        <Button
          type="button"
          @click="router.push({ name: 'CreateEvent' })"
         variant="default" size="sm">
          <Plus class="size-4" aria-hidden="true" /> Tạo sự kiện
        </Button>
      </div>

      <!-- Thẻ thống kê -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card class="shadow-none ring-0 border border-border bg-background rounded-lg gap-0 p-4">
          <p class="text-xs text-muted-foreground">Sự kiện</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-foreground">{{ manageStore.stats?.events ?? '—' }}</p>
        </Card>
        <Card class="shadow-none ring-0 border border-border bg-background rounded-lg gap-0 p-4">
          <p class="text-xs text-muted-foreground">Sắp diễn ra</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-primary">
            {{ manageStore.stats?.upcomingEvents ?? '—' }}
          </p>
        </Card>
        <Card class="shadow-none ring-0 border border-border bg-background rounded-lg gap-0 p-4">
          <p class="text-xs text-muted-foreground">Vé đã bán</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-foreground">
            {{ manageStore.stats?.soldTickets ?? '—' }}
          </p>
        </Card>
        <Card class="shadow-none ring-0 border border-border bg-background rounded-lg gap-0 p-4">
          <p class="text-xs text-muted-foreground">Doanh thu</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-foreground">
            {{ formatPrice(manageStore.stats?.revenue ?? 0) }}
          </p>
        </Card>
      </div>

      <!-- Tìm kiếm -->
      <Card class="shadow-none ring-0 border border-border bg-background rounded-lg gap-0 p-4">
        <div class="relative">
          <Input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo tên sự kiện, địa điểm..."
            class="w-full pl-10" aria-label="Tìm kiếm"
            @input="handleSearchInput"
          />
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search class="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
      </Card>

      <!-- Danh sách -->
      <div>
        <DataState
          :loading="manageStore.loading"
          :loaded="manageStore.loaded"
          :error="manageStore.errorMessage"
          :empty="manageStore.events.length === 0"
          empty-title="Bạn chưa có sự kiện nào"
          empty-description="Tạo sự kiện đầu tiên để bắt đầu bán vé."
          empty-action-label="+ Tạo sự kiện"
          @retry="manageStore.reload()"
          @empty-action="router.push({ name: 'CreateEvent' })"
        >
          <template #skeleton>
            <div class="divide-y divide-border">
              <div v-for="n in 4" :key="n" class="px-5 py-5 flex items-center gap-4">
                <div class="flex-1 space-y-2">
                  <Skeleton class="h-4 w-1/2 bg-muted rounded animate-pulse" />
                  <Skeleton class="h-3 w-1/4 bg-muted rounded animate-pulse" />
                </div>
                <Skeleton class="h-8 w-24 bg-muted rounded-lg animate-pulse" />
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <Card
              v-for="event in manageStore.events"
              :key="event.id"
              :data-tone="event.category || undefined"
              class="shadow-none ring-0 border border-border bg-background group gap-0 rounded-lg p-4 transition-colors"
            >
              <div class="flex flex-col gap-4 sm:grid sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-center">
                <div class="aspect-video w-full overflow-hidden rounded-lg">
                  <EventBanner :src="event.bannerUrl" :alt="event.title">
                    <template #placeholder>
                      <div class="flex h-full w-full items-center justify-center bg-tone-soft">
                        <div class="rounded-md bg-tone px-2 py-1 text-center text-tone-foreground">
                          <div class="text-[10px] font-semibold uppercase tracking-widest">Tháng {{ calendarOf(event).month }}</div>
                          <div class="text-xl font-extrabold tabular-nums leading-tight">{{ calendarOf(event).day }}</div>
                        </div>
                      </div>
                    </template>
                  </EventBanner>
                </div>

                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="min-w-0 text-base font-semibold tracking-tight text-foreground break-words">
                      <router-link
                        :to="{ name: 'EventDetail', params: { id: event.slug ?? event.id } }"
                        class="hover:text-primary transition-colors"
                      >
                        {{ event.title }}
                      </router-link>
                    </h3>
                    <Badge :variant="PHASE_META[phaseOf(event)].variant">{{ PHASE_META[phaseOf(event)].label }}</Badge>
                  </div>

                  <p class="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarDays class="size-4 shrink-0" aria-hidden="true" />
                    <span class="line-clamp-1">{{ formatDateTime(event.startTime) }} · {{ event.location }}</span>
                  </p>

                  <div class="mt-3 flex items-center gap-3">
                    <p class="shrink-0 text-sm tabular-nums text-muted-foreground">
                      <span class="font-medium text-foreground">{{ soldTickets(event) }}</span>
                      /
                      {{ totalTickets(event) }} vé
                    </p>
                    <div
                      v-if="totalTickets(event) > 0"
                      class="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
                      role="img"
                      :aria-label="`Đã bán ${soldPercent(event)}% số vé`"
                    >
                      <div
                        class="h-full rounded-full transition-[width] duration-200"
                        :class="soldPercent(event) >= 90 ? 'bg-brand' : 'bg-tone'"
                        :style="{ width: `${soldPercent(event)}%` }"
                      ></div>
                    </div>
                    <span v-else class="text-xs text-muted-foreground">Chưa mở bán loại vé nào</span>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <Button as-child size="sm"><router-link
                    :to="{ name: 'CheckIn', params: { id: event.id } }"
                    ><ScanLine class="size-4" aria-hidden="true" />Soát vé</router-link></Button>

                  <Button as-child size="sm" variant="ghost"><router-link
                    :to="{ name: 'PromoCodes', params: { id: event.id } }"
                    ><Percent class="size-4" aria-hidden="true" />Mã giảm giá</router-link></Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Thêm thao tác"><MoreHorizontal class="size-4" aria-hidden="true" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="shadow-none">
                      <DropdownMenuItem as-child>
                        <router-link :to="{ name: 'EventDetail', params: { id: event.slug ?? event.id } }"><Eye class="size-4" aria-hidden="true" />Xem</router-link>
                      </DropdownMenuItem>
                      <DropdownMenuItem as-child>
                        <router-link :to="{ name: 'EditEvent', params: { id: event.id } }"><Pencil class="size-4" aria-hidden="true" />Sửa</router-link>
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" class="text-destructive" @select="pendingDelete = event"><Trash2 class="size-4" aria-hidden="true" />Xoá</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          </div>
        </DataState>
      </div>

      <!-- Phân trang -->
      <div
        v-if="manageStore.totalPages > 1 && manageStore.events.length > 0"
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground">
          Tổng <strong class="text-foreground">{{ manageStore.total }}</strong> sự kiện
        </p>

        <div class="flex items-center gap-2">
          <Button
            type="button"
            :disabled="manageStore.page === 1"
            @click="changePage(manageStore.page - 1)"
           variant="outline" size="sm">
            Trước
          </Button>

          <span class="text-sm text-muted-foreground px-3">
            Trang <strong class="text-foreground">{{ manageStore.page }}</strong>
            / {{ manageStore.totalPages }}
          </span>

          <Button
            type="button"
            :disabled="manageStore.page === manageStore.totalPages"
            @click="changePage(manageStore.page + 1)"
           variant="outline" size="sm">
            Sau
          </Button>
        </div>
      </div>
    </div>

    <!-- Xác nhận xoá -->
    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Xoá sự kiện?"
      :message="deleteConfirmMessage"
      confirm-label="Xoá sự kiện"
      danger
      :loading="deleteBusy"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>
