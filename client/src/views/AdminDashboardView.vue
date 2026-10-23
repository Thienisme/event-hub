<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../api/axios';
import DataState from '../components/DataState.vue';
import { formatPrice, formatDateTime } from '../utils/format';

interface AdminStats {
  users: number;
  organizers: number;
  events: number;
  orders: number;
  confirmedOrders: number;
  revenue: number | string;
  recentOrders: {
    id: string;
    totalAmount: number | string;
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
    createdAt: string;
    user: { id: string; fullName: string; email: string };
  }[];
}

const router = useRouter();

const stats = ref<AdminStats | null>(null);
const loading = ref(false);
const loaded = ref(false);
const errorMessage = ref('');

const statusLabel: Record<string, string> = {
  PENDING: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
};

const statusClass: Record<string, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  CONFIRMED: 'bg-green-50 text-green-700 border-green-200',
  CANCELLED: 'bg-red-50 text-red-600 border-red-200',
  EXPIRED: 'bg-gray-100 text-gray-600 border-gray-200',
};

let inFlight: AbortController | undefined;

const loadStats = async () => {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  loading.value = true;
  errorMessage.value = '';

  try {
    const { data } = await apiClient.get<{ data: AdminStats }>('/admin/stats', {
      signal: controller.signal,
    });
    stats.value = data.data;
  } catch (error: any) {
    if (error?.code === 'ERR_CANCELED') return;
    errorMessage.value =
      error.response?.data?.message || 'Không tải được thống kê hệ thống!';
  } finally {
    loading.value = false;
    loaded.value = true;
  }
};

onMounted(loadStats);
onUnmounted(() => inFlight?.abort());
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">Tổng quan hệ thống</h1>
          <p class="mt-1 text-sm text-gray-500">Số liệu toàn bộ nền tảng</p>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            @click="router.push({ name: 'AdminAuditLogs' })"
          >
            Nhật ký
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            @click="router.push({ name: 'AdminUsers' })"
          >
            Quản lý người dùng →
          </button>
          <button
            type="button"
            :disabled="loading"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            @click="loadStats"
          >
            {{ loading ? 'Đang tải...' : 'Làm mới' }}
          </button>
        </div>
      </div>

      <DataState
        :loading="loading"
        :loaded="loaded"
        :error="errorMessage"
        error-title="Không tải được thống kê"
        @retry="loadStats"
      >
        <template #skeleton>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div v-for="n in 4" :key="n" class="bg-white border border-gray-100 rounded-xl p-5">
              <div class="h-3 w-20 bg-gray-200 rounded animate-pulse"></div>
              <div class="mt-3 h-8 w-16 bg-gray-200 rounded animate-pulse"></div>
            </div>
          </div>
        </template>

        <div class="space-y-6">
          <!-- Thẻ số liệu -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white border border-gray-100 rounded-xl p-5">
              <p class="text-xs text-gray-500">Người dùng</p>
              <p class="mt-2 text-3xl font-extrabold text-gray-900">{{ stats?.users ?? 0 }}</p>
              <p class="mt-1 text-xs text-gray-400">
                +{{ stats?.organizers ?? 0 }} ban tổ chức
              </p>
            </div>

            <div class="bg-white border border-gray-100 rounded-xl p-5">
              <p class="text-xs text-gray-500">Sự kiện</p>
              <p class="mt-2 text-3xl font-extrabold text-indigo-600">{{ stats?.events ?? 0 }}</p>
              <p class="mt-1 text-xs text-gray-400">đang có trên nền tảng</p>
            </div>

            <div class="bg-white border border-gray-100 rounded-xl p-5">
              <p class="text-xs text-gray-500">Đơn hàng</p>
              <p class="mt-2 text-3xl font-extrabold text-gray-900">{{ stats?.orders ?? 0 }}</p>
              <p class="mt-1 text-xs text-gray-400">
                {{ stats?.confirmedOrders ?? 0 }} đã xác nhận
              </p>
            </div>

            <div class="bg-white border border-gray-100 rounded-xl p-5">
              <p class="text-xs text-gray-500">Doanh thu</p>
              <p class="mt-2 text-3xl font-extrabold text-green-600">
                {{ formatPrice(stats?.revenue ?? 0) }}
              </p>
              <p class="mt-1 text-xs text-gray-400">từ đơn đã xác nhận</p>
            </div>
          </div>

          <!-- Đơn hàng gần đây -->
          <div class="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <header class="px-5 py-4 border-b border-gray-100">
              <h2 class="text-lg font-bold text-gray-900">Đơn hàng gần đây</h2>
            </header>

            <div v-if="!stats?.recentOrders?.length" class="px-5 py-12 text-center text-sm text-gray-500">
              Chưa có đơn hàng nào.
            </div>

            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th class="px-5 py-3 font-semibold">Mã đơn</th>
                    <th class="px-5 py-3 font-semibold">Khách hàng</th>
                    <th class="px-5 py-3 font-semibold">Số tiền</th>
                    <th class="px-5 py-3 font-semibold">Trạng thái</th>
                    <th class="px-5 py-3 font-semibold">Thời điểm</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="order in stats.recentOrders" :key="order.id" class="hover:bg-gray-50/70">
                    <td class="px-5 py-3 font-mono text-xs font-semibold text-gray-900">
                      #{{ order.id.slice(0, 8).toUpperCase() }}
                    </td>
                    <td class="px-5 py-3">
                      <p class="font-medium text-gray-900">{{ order.user.fullName }}</p>
                      <p class="text-xs text-gray-500">{{ order.user.email }}</p>
                    </td>
                    <td class="px-5 py-3 font-medium text-gray-900">
                      {{ formatPrice(order.totalAmount) }}
                    </td>
                    <td class="px-5 py-3">
                      <span
                        class="px-2.5 py-1 text-xs font-semibold rounded-full border"
                        :class="statusClass[order.status]"
                      >
                        {{ statusLabel[order.status] }}
                      </span>
                    </td>
                    <td class="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {{ formatDateTime(order.createdAt) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DataState>
    </div>
  </div>
</template>
