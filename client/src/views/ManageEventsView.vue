<script setup lang="ts">
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
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">Sự kiện của tôi</h1>
          <p class="mt-1 text-sm text-gray-500">Quản lý các sự kiện bạn đang phụ trách</p>
        </div>

        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          @click="router.push({ name: 'CreateEvent' })"
        >
          + Tạo sự kiện
        </button>
      </div>

      <!-- Thẻ thống kê -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Sự kiện</p>
          <p class="mt-1 text-2xl font-extrabold text-gray-900">{{ manageStore.stats?.events ?? '—' }}</p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Sắp diễn ra</p>
          <p class="mt-1 text-2xl font-extrabold text-indigo-600">
            {{ manageStore.stats?.upcomingEvents ?? '—' }}
          </p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Vé đã bán</p>
          <p class="mt-1 text-2xl font-extrabold text-green-600">
            {{ manageStore.stats?.soldTickets ?? '—' }}
          </p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Doanh thu</p>
          <p class="mt-1 text-2xl font-extrabold text-gray-900">
            {{ formatPrice(manageStore.stats?.revenue ?? 0) }}
          </p>
        </div>
      </div>

      <!-- Tìm kiếm -->
      <div class="bg-white border border-gray-100 rounded-xl p-4">
        <div class="relative">
          <input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo tên sự kiện, địa điểm..."
            class="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
            @input="handleSearchInput"
          />
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Danh sách -->
      <div class="bg-white border border-gray-100 rounded-xl overflow-hidden">
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
            <div class="divide-y divide-gray-100">
              <div v-for="n in 4" :key="n" class="px-5 py-5 flex items-center gap-4">
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-1/2 bg-gray-200 rounded animate-pulse"></div>
                  <div class="h-3 w-1/4 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div class="h-8 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
              </div>
            </div>
          </template>

          <div class="divide-y divide-gray-100">
            <article
              v-for="event in manageStore.events"
              :key="event.id"
              class="p-5 hover:bg-gray-50/70 transition-colors"
            >
              <div class="flex flex-col lg:flex-row lg:items-center gap-4">
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-gray-900 truncate">
                    <router-link
                      :to="{ name: 'EventDetail', params: { id: event.id } }"
                      class="hover:text-indigo-600 transition-colors"
                    >
                      {{ event.title }}
                    </router-link>
                  </h3>

                  <p class="mt-1 text-sm text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span class="inline-flex items-center gap-1">
                      <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {{ formatDateTime(event.startTime) }}
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {{ event.location }}
                    </span>
                  </p>

                  <p class="mt-2 text-xs text-gray-500">
                    <strong class="text-gray-700">{{ soldTickets(event) }}</strong>
                    /
                    {{ totalTickets(event) }} vé đã bán
                    <span v-if="event.ticketTypes.length === 0" class="ml-2 text-gray-400">
                      (chưa mở bán loại vé nào)
                    </span>
                  </p>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <router-link
                    :to="{ name: 'EventDetail', params: { id: event.id } }"
                    class="px-3 py-2 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Xem
                  </router-link>

                  <router-link
                    :to="{ name: 'EditEvent', params: { id: event.id } }"
                    class="px-3 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                  >
                    Sửa
                  </router-link>

                  <button
                    type="button"
                    class="px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    @click="pendingDelete = event"
                  >
                    Xoá
                  </button>
                </div>
              </div>
            </article>
          </div>
        </DataState>
      </div>

      <!-- Phân trang -->
      <div
        v-if="manageStore.totalPages > 1 && manageStore.events.length > 0"
        class="flex items-center justify-between gap-3"
      >
        <p class="text-sm text-gray-500">
          Tổng <strong class="text-gray-900">{{ manageStore.total }}</strong> sự kiện
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="manageStore.page === 1"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(manageStore.page - 1)"
          >
            Trước
          </button>

          <span class="text-sm text-gray-600 px-3">
            Trang <strong class="text-gray-900">{{ manageStore.page }}</strong>
            / {{ manageStore.totalPages }}
          </span>

          <button
            type="button"
            :disabled="manageStore.page === manageStore.totalPages"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(manageStore.page + 1)"
          >
            Sau
          </button>
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
