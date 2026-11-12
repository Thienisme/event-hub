<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import EventBanner from '@/components/EventBanner.vue';
import { Plus, Search, CalendarDays, MapPin, Eye, Pencil, Trash2, ScanLine, MoreHorizontal } from '@lucide/vue';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useManageStore } from '../stores/manage';
import type { ManagedEvent } from '../stores/manage';
import { useToastStore } from '../stores/toast';
import apiClient from '../api/axios';
import DataState from '../components/DataState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { formatDateTime, formatPrice } from '../utils/format';

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
          <p class="mt-1 text-sm text-muted-foreground">Quản lý các sự kiện bạn đang phụ trách</p>
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
              class="shadow-none ring-0 border border-border bg-background group gap-0 rounded-lg p-4 transition-colors"
            >
              <div class="flex flex-col sm:flex-row sm:items-start gap-4">
                <div class="aspect-video w-full overflow-hidden rounded-lg sm:w-40 lg:w-48 shrink-0"><EventBanner :src="event.bannerUrl" :alt="event.title" /></div><div class="flex-1 min-w-0">
                  <h3 class="font-semibold tracking-tight text-foreground break-words">
                    <router-link
                      :to="{ name: 'EventDetail', params: { id: event.slug ?? event.id } }"
                      class="hover:text-primary transition-colors"
                    >
                      {{ event.title }}
                    </router-link>
                  </h3>

                  <p class="mt-1 text-sm text-muted-foreground break-all flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span class="inline-flex min-w-0 items-start gap-1 break-words">
                      <CalendarDays class="size-4 shrink-0" aria-hidden="true" />
                      {{ formatDateTime(event.startTime) }}
                    </span>
                    <span class="inline-flex min-w-0 items-start gap-1 break-words">
                      <MapPin class="size-4 shrink-0" aria-hidden="true" />
                      {{ event.location }}
                    </span>
                  </p>

                  <p class="mt-2 text-xs tabular-nums text-muted-foreground">
                    <strong class="text-foreground">{{ soldTickets(event) }}</strong>
                    /
                    {{ totalTickets(event) }} vé đã bán
                    <span v-if="event.ticketTypes.length === 0" class="ml-2 text-muted-foreground">
                      (chưa mở bán loại vé nào)
                    </span>
                  </p>
                </div>

                <div class="flex items-center gap-2 shrink-0 sm:flex-col lg:flex-row">
                  <Button as-child size="sm" variant="outline"><router-link
                    :to="{ name: 'EventDetail', params: { id: event.slug ?? event.id } }"
                    ><Eye class="size-4" aria-hidden="true" />Xem</router-link></Button>

                  <Button as-child size="sm" variant="outline"><router-link
                    :to="{ name: 'CheckIn', params: { id: event.id } }"
                    ><ScanLine class="size-4" aria-hidden="true" />Soát vé</router-link></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Thêm thao tác"><MoreHorizontal class="size-4" aria-hidden="true" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="shadow-none">
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
