<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { RefreshCw, ScrollText, Users, CalendarDays, ShoppingCart, Wallet, Inbox } from '@lucide/vue';

import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
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
  <div class="min-h-screen bg-surface py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold text-foreground tracking-tight">Tổng quan hệ thống</h1>
          <p class="mt-1 text-sm text-muted-foreground">Số liệu toàn bộ nền tảng</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            @click="router.push({ name: 'AdminAuditLogs' })"
           variant="outline" size="sm">
            <ScrollText class="size-4" aria-hidden="true" /> Nhật ký
          </Button>
          <Button
            type="button"
            @click="router.push({ name: 'AdminUsers' })"
           variant="outline" size="sm">
            <Users class="size-4" aria-hidden="true" /> Quản lý người dùng
          </Button>
          <Button
            type="button"
            :disabled="loading"
            @click="loadStats"
           variant="default" size="sm">
            <RefreshCw class="size-4" :class="{ 'animate-spin': loading }" aria-hidden="true" /> {{ loading ? 'Đang tải...' : 'Làm mới' }}
          </Button>
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
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card v-for="n in 4" :key="n" class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-5">
              <Skeleton class="h-3 w-20 bg-muted rounded animate-pulse" />
              <Skeleton class="mt-3 h-8 w-16 bg-muted rounded animate-pulse" />
            </Card>
          </div>
        </template>

        <div class="space-y-6">
          <!-- Thẻ số liệu -->
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-5">
              <div class="flex items-center justify-between gap-2"><p class="text-sm text-muted-foreground">Người dùng</p><span class="rounded-full bg-primary/10 p-2 text-primary"><Users class="size-5" aria-hidden="true" /></span></div>
              <p class="mt-2 break-words text-2xl lg:text-3xl font-semibold tabular-nums text-foreground">{{ stats?.users ?? 0 }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                +{{ stats?.organizers ?? 0 }} ban tổ chức
              </p>
            </Card>

            <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-5">
              <div class="flex items-center justify-between gap-2"><p class="text-sm text-muted-foreground">Sự kiện</p><span class="rounded-full bg-info/10 p-2 text-info"><CalendarDays class="size-5" aria-hidden="true" /></span></div>
              <p class="mt-2 break-words text-2xl lg:text-3xl font-semibold tabular-nums text-primary">{{ stats?.events ?? 0 }}</p>
              <p class="mt-1 text-xs text-muted-foreground">đang có trên nền tảng</p>
            </Card>

            <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-5">
              <div class="flex items-center justify-between gap-2"><p class="text-sm text-muted-foreground">Đơn hàng</p><span class="rounded-full bg-warning/10 p-2 text-warning"><ShoppingCart class="size-5" aria-hidden="true" /></span></div>
              <p class="mt-2 break-words text-2xl lg:text-3xl font-semibold tabular-nums text-foreground">{{ stats?.orders ?? 0 }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ stats?.confirmedOrders ?? 0 }} đã xác nhận
              </p>
            </Card>

            <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-5">
              <div class="flex items-center justify-between gap-2"><p class="text-sm text-muted-foreground">Doanh thu</p><span class="rounded-full bg-success/10 p-2 text-success"><Wallet class="size-5" aria-hidden="true" /></span></div>
              <p class="mt-2 break-words text-2xl lg:text-3xl font-semibold tabular-nums text-success">
                {{ formatPrice(stats?.revenue ?? 0) }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">từ đơn đã xác nhận</p>
            </Card>
          </div>

          <!-- Đơn hàng gần đây -->
          <Card class="bg-card border border-border rounded-2xl gap-0 py-0 shadow-sm overflow-hidden">
            <header class="px-5 py-4 border-b border-border">
              <h2 class="text-lg font-semibold text-foreground">Đơn hàng gần đây</h2>
            </header>

            <div v-if="!stats?.recentOrders?.length" class="px-5 py-12 text-center text-sm text-muted-foreground">
              <Inbox class="mx-auto mb-3 size-10 text-muted-foreground" aria-hidden="true" />Chưa có đơn hàng nào.
            </div>

            <div v-else><div class="grid gap-3 p-4 md:hidden"><article v-for="order in stats.recentOrders" :key="order.id" class="rounded-xl border bg-card p-4 shadow-sm space-y-3 break-all">
                    <div>
                      #{{ order.id.slice(0, 8).toUpperCase() }}
                    </div>
                    <div>
                      <p class="font-medium text-foreground">{{ order.user.fullName }}</p>
                      <p class="text-xs text-muted-foreground">{{ order.user.email }}</p>
                    </div>
                    <div>
                      {{ formatPrice(order.totalAmount) }}
                    </div>
                    <div>
                      <OrderStatusBadge :status="order.status" />
                    </div>
                    <div>
                      {{ formatDateTime(order.createdAt) }}
                    </div>
                  </article></div><div class="hidden md:block">
              <Table class="w-full table-fixed text-sm [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal">
                <TableHeader class="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <TableRow>
                    <TableHead class="px-5 py-3 font-semibold">Mã đơn</TableHead>
                    <TableHead class="px-5 py-3 font-semibold">Khách hàng</TableHead>
                    <TableHead class="px-5 py-3 font-semibold">Số tiền</TableHead>
                    <TableHead class="px-5 py-3 font-semibold">Trạng thái</TableHead>
                    <TableHead class="px-5 py-3 font-semibold">Thời điểm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody class="divide-y divide-border">
                  <TableRow v-for="order in stats.recentOrders" :key="order.id" class="hover:bg-surface/70">
                    <TableCell class="px-5 py-3 font-mono text-xs font-semibold text-foreground">
                      #{{ order.id.slice(0, 8).toUpperCase() }}
                    </TableCell>
                    <TableCell class="px-5 py-3">
                      <p class="font-medium text-foreground">{{ order.user.fullName }}</p>
                      <p class="text-xs text-muted-foreground">{{ order.user.email }}</p>
                    </TableCell>
                    <TableCell class="px-5 py-3 font-medium tabular-nums text-foreground">
                      {{ formatPrice(order.totalAmount) }}
                    </TableCell>
                    <TableCell class="px-5 py-3">
                      <OrderStatusBadge :status="order.status" />
                    </TableCell>
                    <TableCell class="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {{ formatDateTime(order.createdAt) }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            </div>
          </Card>
        </div>
      </DataState>
    </div>
  </div>
</template>
