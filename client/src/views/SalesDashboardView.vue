<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, BarChart3, ScanLine, Ticket } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import DataState from '@/components/DataState.vue';
import RevenueChart from '@/components/RevenueChart.vue';
import { DASHBOARD_RANGES, useDashboardStore } from '@/stores/dashboard';
import type { DashboardRange } from '@/stores/dashboard';
import { formatDateTime, formatPrice } from '@/utils/format';

/**
 * Bảng điều khiển bán vé: số tổng toàn thời gian, doanh thu theo ngày, loại vé bán
 * chạy, tỉ lệ vào cổng. Bộ lọc (sự kiện, khoảng ngày) nằm trên URL để F5 hay gửi
 * link vẫn giữ nguyên lựa chọn.
 */
const route = useRoute();
const router = useRouter();
const store = useDashboardStore();

const eventId = computed(() => (typeof route.query.eventId === 'string' && route.query.eventId ? route.query.eventId : null));
const days = computed<DashboardRange>(() => {
  const value = Number(route.query.days);
  return (DASHBOARD_RANGES as number[]).includes(value) ? (value as DashboardRange) : 30;
});

watch([eventId, days], ([id, range]) => {
  void store.fetchDashboard({ eventId: id, days: range });
}, { immediate: true });

const setQuery = (patch: Record<string, string | undefined>) => {
  void router.replace({ query: { ...route.query, ...patch } });
};
// v-model của ô chọn sự kiện: '' = tất cả sự kiện.
const selectedEvent = computed({
  get: () => eventId.value ?? '',
  set: (value: string) => setQuery({ eventId: value || undefined }),
});
const setDays = (value: DashboardRange) => setQuery({ days: value === 30 ? undefined : String(value) });

const data = computed(() => store.data);
const summary = computed(() => data.value?.summary);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const rangeRevenue = computed(() => data.value?.daily.reduce((sum, d) => sum + d.revenue, 0) ?? 0);
const topTypes = computed(() => data.value?.ticketTypes.slice(0, 10) ?? []);
const showEventTitle = computed(() => !data.value?.eventId);
const noEvents = computed(() => store.loaded && !store.errorMessage && (data.value?.events.length ?? 0) === 0);
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <Button as-child variant="outline" size="sm">
        <router-link :to="{ name: 'MyEvents' }"><ArrowLeft class="size-4" aria-hidden="true" />Sự kiện của tôi</router-link>
      </Button>

      <header class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="space-y-2">
          <p class="flex items-center gap-2 text-sm font-medium text-primary"><BarChart3 class="size-4" aria-hidden="true" />Nhà tổ chức</p>
          <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Bảng điều khiển bán vé</h1>
          <p class="text-sm text-muted-foreground">Chỉ tính đơn đã thanh toán; doanh thu đã trừ giảm giá.</p>
        </div>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="space-y-1.5 sm:w-72">
            <Label for="dashboard-event">Sự kiện</Label>
            <NativeSelect id="dashboard-event" v-model="selectedEvent" class="w-full">
              <NativeSelectOption value="">Tất cả sự kiện</NativeSelectOption>
              <NativeSelectOption v-for="event in data?.events ?? []" :key="event.id" :value="event.id">{{ event.title }}</NativeSelectOption>
            </NativeSelect>
          </div>
          <div role="group" aria-label="Khoảng thời gian" class="inline-flex rounded-md border border-border bg-background p-0.5">
            <Button
              v-for="range in DASHBOARD_RANGES"
              :key="range"
              type="button"
              size="sm"
              :variant="days === range ? 'default' : 'ghost'"
              :aria-pressed="days === range"
              @click="setDays(range)"
            >{{ range }} ngày</Button>
          </div>
        </div>
      </header>

      <DataState
        :loading="store.loading && !data"
        :loaded="store.loaded"
        :error="store.errorMessage"
        :empty="noEvents"
        empty-title="Bạn chưa có sự kiện nào"
        empty-description="Tạo sự kiện và mở bán vé, số liệu sẽ hiện ở đây."
        empty-action-label="Tạo sự kiện"
        @empty-action="router.push({ name: 'CreateEvent' })"
        @retry="store.fetchDashboard({ eventId, days })"
      >
        <div v-if="data && summary" class="space-y-6" :aria-busy="store.loading">
          <!-- Số tổng: toàn thời gian trong phạm vi sự kiện đang chọn -->
          <section aria-labelledby="summary-title" class="space-y-3">
            <h2 id="summary-title" class="text-sm font-medium text-muted-foreground">Toàn thời gian</h2>
            <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-lg border border-border bg-background p-4">
                <dt class="text-sm text-muted-foreground">Doanh thu</dt>
                <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ formatPrice(summary.revenue) }}</dd>
                <dd class="mt-1 text-xs text-muted-foreground">{{ summary.discount > 0 ? `Đã giảm giá ${formatPrice(summary.discount)}` : 'Chưa dùng mã giảm giá' }}</dd>
              </div>
              <div class="rounded-lg border border-border bg-background p-4">
                <dt class="text-sm text-muted-foreground">Vé đã bán</dt>
                <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.ticketsSold.toLocaleString('vi-VN') }}</dd>
                <dd class="mt-1 text-xs text-muted-foreground">trên {{ summary.capacity.toLocaleString('vi-VN') }} vé · {{ percent(summary.ticketsSold, summary.capacity) }}%</dd>
              </div>
              <div class="rounded-lg border border-border bg-background p-4">
                <dt class="text-sm text-muted-foreground">Đơn đã thanh toán</dt>
                <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.orders.toLocaleString('vi-VN') }}</dd>
                <dd class="mt-1 text-xs text-muted-foreground">{{ summary.orders > 0 ? `Trung bình ${formatPrice(Math.round(summary.revenue / summary.orders))} / đơn` : 'Chưa có đơn' }}</dd>
              </div>
              <div class="rounded-lg border border-border bg-background p-4">
                <dt class="text-sm text-muted-foreground">Tỉ lệ vào cổng</dt>
                <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ percent(summary.checkedIn, summary.ticketsSold) }}%</dd>
                <dd class="mt-1 text-xs text-muted-foreground">{{ summary.checkedIn.toLocaleString('vi-VN') }} / {{ summary.ticketsSold.toLocaleString('vi-VN') }} vé đã soát</dd>
              </div>
            </dl>
          </section>

          <Card class="gap-4 rounded-lg border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
            <section aria-labelledby="daily-title" class="space-y-4">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="daily-title" class="text-lg font-semibold tracking-tight">Doanh thu theo ngày</h2>
                <p class="text-sm text-muted-foreground">{{ data.range.days }} ngày gần nhất · <span class="font-semibold tabular-nums text-foreground">{{ formatPrice(rangeRevenue) }}</span></p>
              </div>
              <RevenueChart :daily="data.daily" />
              <p class="text-xs text-muted-foreground">Theo ngày đặt đơn, giờ Việt Nam.</p>
            </section>
          </Card>

          <div class="grid items-start gap-6 lg:grid-cols-2">
            <Card class="gap-4 rounded-lg border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
              <section aria-labelledby="types-title" class="space-y-4">
                <h2 id="types-title" class="flex items-center gap-2 text-lg font-semibold tracking-tight"><Ticket class="size-4" aria-hidden="true" />Loại vé bán chạy</h2>
                <p v-if="topTypes.length === 0" class="text-sm text-muted-foreground">Chưa có loại vé nào.</p>
                <ol v-else class="space-y-4">
                  <li v-for="type in topTypes" :key="type.id" class="space-y-1.5">
                    <div class="flex items-baseline justify-between gap-3">
                      <div class="min-w-0">
                        <p class="break-words font-medium">{{ type.name }}</p>
                        <p v-if="showEventTitle" class="break-words text-xs text-muted-foreground">{{ type.eventTitle }}</p>
                      </div>
                      <p class="shrink-0 text-right text-sm tabular-nums">
                        <span class="font-semibold">{{ type.sold.toLocaleString('vi-VN') }}</span><span class="text-muted-foreground"> / {{ type.total.toLocaleString('vi-VN') }} vé</span>
                      </p>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div class="h-full rounded-full bg-chart-2" :style="{ width: `${percent(type.sold, type.total)}%` }" />
                    </div>
                    <p class="text-xs text-muted-foreground tabular-nums">{{ percent(type.sold, type.total) }}% đã bán · {{ formatPrice(type.revenue) }}</p>
                  </li>
                </ol>
              </section>
            </Card>

            <Card class="gap-4 rounded-lg border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
              <section aria-labelledby="checkin-title" class="space-y-4">
                <h2 id="checkin-title" class="flex items-center gap-2 text-lg font-semibold tracking-tight"><ScanLine class="size-4" aria-hidden="true" />Tỉ lệ vào cổng theo sự kiện</h2>
                <p v-if="data.eventsCheckIn.length === 0" class="text-sm text-muted-foreground">Chưa có sự kiện nào bán được vé.</p>
                <ol v-else class="space-y-4">
                  <li v-for="event in data.eventsCheckIn" :key="event.id" class="space-y-1.5">
                    <div class="flex items-baseline justify-between gap-3">
                      <div class="min-w-0">
                        <router-link :to="{ name: 'CheckIn', params: { id: event.id } }" class="break-words font-medium hover:underline">{{ event.title }}</router-link>
                        <p class="text-xs text-muted-foreground">{{ formatDateTime(event.startTime) }}</p>
                      </div>
                      <p class="shrink-0 text-right text-sm tabular-nums">
                        <span class="font-semibold">{{ percent(event.checkedIn, event.sold) }}%</span>
                      </p>
                    </div>
                    <div class="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div class="h-full rounded-full bg-chart-2" :style="{ width: `${percent(event.checkedIn, event.sold)}%` }" />
                    </div>
                    <p class="text-xs text-muted-foreground tabular-nums">{{ event.checkedIn.toLocaleString('vi-VN') }} / {{ event.sold.toLocaleString('vi-VN') }} vé đã vào cổng</p>
                  </li>
                </ol>
              </section>
            </Card>
          </div>
        </div>
      </DataState>
    </div>
  </main>
</template>
