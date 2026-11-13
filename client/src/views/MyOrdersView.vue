<script setup lang="ts">
import TicketDate from '@/components/TicketDate.vue';
import { categoryLabel } from '@/utils/categories';
import { resolveMediaUrl } from '@/utils/media';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useOrderStore } from '../stores/order';
import type { Order, OrderStatus, OrderTicket } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import { useToastStore } from '../stores/toast';
import { formatPrice, formatDateTime } from '../utils/format';
import { CalendarDays, MapPin, Copy, Ticket, Timer, AlertCircle, QrCode, ChevronDown } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import QrCodeImage from '../components/QrCodeImage.vue';

const route = useRoute();
const router = useRouter();
const orderStore = useOrderStore();
const authStore = useAuthStore();
const toastStore = useToastStore();

const errorMessage = ref('');

// Xem ghi chú ở HomeView: thiếu cờ này thì lần render đầu (trước onMounted)
// sẽ nháy lên "Bạn chưa có vé nào" dù user đang có đơn.
const loaded = ref(false);

const loadOrders = async (page?: number, limit?: number) => {
  errorMessage.value = '';
  try {
    await orderStore.fetchMyOrders(page, limit);
  } catch (error: any) {
    const status = error.response?.status;

    // BE trả 403 khi token hết hạn/không hợp lệ, 401 khi thiếu token.
    // Token nằm ở localStorage nên store vẫn "tưởng" đã đăng nhập -> phải dọn tay.
    if (status === 401 || status === 403) {
      authStore.logout();
      router.push({ name: 'Login', query: { redirect: route.fullPath } });
      return;
    }

    errorMessage.value =
      error.response?.data?.message || 'Không tải được danh sách đơn hàng!';
  } finally {
    loaded.value = true;
  }
};

const changePage = (page: number) => {
  if (page < 1 || page > orderStore.pagination.totalPages || orderStore.loading) return;
  loadOrders(page, orderStore.pagination.limit);
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

/**
 * Đồng hồ đếm ngược dùng chung cho mọi đơn PENDING: một interval cập nhật
 * `now`, mỗi đơn tự tính phần còn lại. Nhờ vậy không phải tạo/thu dọn timer
 * cho từng đơn khi danh sách đổi.
 */
const now = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  // Luôn về trang 1: đơn mới nhất nằm ở đó, người vừa đặt vé phải thấy ngay.
  loadOrders();
  countdownTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});

const remainingMs = (order: Order): number => {
  if (!order.expiresAt) return 0;
  return new Date(order.expiresAt).getTime() - now.value;
};

/**
 * Quá giờ giữ chỗ nhưng job nền có thể chưa kịp chuyển EXPIRED. Server đã coi
 * đơn PENDING quá hạn là hết hạn (confirm trả 409), nên UI ẩn nút thao tác luôn.
 */
const isHoldExpired = (order: Order): boolean =>
  order.status === 'PENDING' && remainingMs(order) <= 0;

/** Nhãn hiển thị: đơn PENDING quá hạn trông giống EXPIRED dù DB chưa đổi. */
const displayStatus = (order: Order): OrderStatus =>
  isHoldExpired(order) ? 'EXPIRED' : order.status;

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/** Đơn có giảm giá: subtotalAmount/discountAmount là Decimal (chuỗi) -> ép Number. */
const hasDiscount = (order: Order): boolean => Number(order.discountAmount) > 0;

/** Id đơn đang gửi request thanh toán/huỷ -> disable nút để tránh bấm hai lần. */
const actionOrderId = ref<string | null>(null);

const cancelTarget = ref<Order | null>(null);
const cancelLoading = ref(false);

const cancelMessage = computed(() => {
  if (!cancelTarget.value) return '';
  return `Đơn #${cancelTarget.value.id.slice(0, 8).toUpperCase()} sẽ bị huỷ và vé được trả lại cho sự kiện. Bạn không thể thanh toán đơn này nữa.`;
});

/**
 * 409 nghĩa là đơn đã bị tab/thiết bị khác huỷ, đã thanh toán, hoặc job hết hạn
 * vừa chạy. KHÔNG đăng xuất người dùng vì phiên vẫn hợp lệ; chỉ báo lỗi và tải
 * lại danh sách để giao diện phản ánh trạng thái thật.
 */
const handleActionError = async (error: any, fallback: string) => {
  const status = error.response?.status;

  if (status === 401 || status === 403) {
    authStore.logout();
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }

  toastStore.error(error.response?.data?.message || fallback);

  if (status === 409) {
    try {
      const currentPage = orderStore.pagination.page;
      const totalPages = orderStore.pagination.totalPages;
      await orderStore.fetchMyOrders(currentPage, orderStore.pagination.limit);
      // Nếu trang hiện tại không còn đơn nào và page > 1 thì lùi về trang trước
      if (orderStore.orders.length === 0 && currentPage > 1 && currentPage <= totalPages) {
        await loadOrders(currentPage - 1, orderStore.pagination.limit);
      }
    } catch {
      // Đây chỉ là lần tải lại để đồng bộ UI; lỗi chính đã hiện ở toast.
    }
  }
};

const askCancel = (order: Order) => {
  if (actionOrderId.value) return;
  cancelTarget.value = order;
};

const handleCancel = async () => {
  const order = cancelTarget.value;
  if (!order || cancelLoading.value) return;

  cancelLoading.value = true;
  actionOrderId.value = order.id;
  try {
    const response = await orderStore.cancelOrder(order.id);
    cancelTarget.value = null;
    toastStore.success(response.message || 'Đã huỷ đơn hàng!');
  } catch (error: any) {
    cancelTarget.value = null;
    await handleActionError(error, 'Huỷ đơn thất bại, vui lòng thử lại!');
  } finally {
    cancelLoading.value = false;
    actionOrderId.value = null;
  }
};

/** Mã QR đang xem lớn trong hộp thoại. */
const selectedQr = ref<{ qrCode: string; label: string; filename: string } | null>(null);

const openQr = (order: Order, ticket: OrderTicket) => {
  if (!ticket.qrCode) return;

  const position = order.tickets.findIndex((item) => item.id === ticket.id) + 1;
  selectedQr.value = {
    qrCode: ticket.qrCode,
    label: `${ticket.ticketType?.name ?? 'Vé'} · Vé ${position}/${order.tickets.length}`,
    filename: `eventhub-${order.id.slice(0, 8)}-ve-${position}.png`,
  };
};

/**
 * BE tạo mỗi vé là 1 record riêng (quantity vé = quantity record),
 * nên gom lại theo ticketTypeId để hiển thị thành dòng "VIP x 2".
 */
interface TicketLine {
  id: string;
  name: string;
  price: number | string;
  quantity: number;
  event?: { title: string; startTime: string; location: string };
}

const groupTickets = (order: Order): TicketLine[] => {
  const grouped = new Map<string, TicketLine>();

  for (const ticket of order.tickets) {
    const current = grouped.get(ticket.ticketTypeId);
    if (current) {
      current.quantity += 1;
    } else {
      grouped.set(ticket.ticketTypeId, {
        id: ticket.ticketTypeId,
        name: ticket.ticketType?.name ?? 'Loại vé',
        price: ticket.ticketType?.price ?? 0,
        quantity: 1,
        event: ticket.ticketType?.event,
      });
    }
  }

  return Array.from(grouped.values());
};
const eventOf = (order: Order) => order.tickets[0]?.ticketType?.event;
const failedImages = ref(new Set<string>());
const imageOf = (order: Order) => failedImages.value.has(order.id) ? null : resolveMediaUrl(eventOf(order)?.bannerUrl);
const isClosed = (order: Order) => ['CANCELLED', 'EXPIRED'].includes(displayStatus(order));
const upcomingOrders = computed(() => orderStore.orders
  .filter(order => order.status === 'CONFIRMED' && new Date(eventOf(order)?.startTime ?? '').getTime() > now.value)
  .sort((a, b) => new Date(eventOf(a)!.startTime).getTime() - new Date(eventOf(b)!.startTime).getTime()));
const nextOrder = computed(() => upcomingOrders.value[0]);
const summary = computed(() => {
  const upcoming = new Set(upcomingOrders.value.map(order => eventOf(order)?.slug ?? `${eventOf(order)?.title}|${eventOf(order)?.startTime}`)).size;
  const pending = orderStore.orders.filter(order => displayStatus(order) === 'PENDING').length;
  return [upcoming ? `${upcoming} sự kiện sắp tới` : '', pending ? `${pending} đơn chờ thanh toán` : ''].filter(Boolean).join(' · ');
});
const nextCountdown = computed(() => {
  if (!nextOrder.value) return '';
  const start = new Date(eventOf(nextOrder.value)!.startTime);
  const today = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (today.format(start) === today.format(now.value)) return 'Hôm nay';
  const hours = (start.getTime() - now.value) / 3600000;
  return hours < 24 ? `còn ${Math.ceil(hours)} giờ` : `còn ${Math.ceil(hours / 24)} ngày`;
});
const revealNextQr = async () => {
  if (!nextOrder.value) return;
  const id = nextOrder.value.id;
  expandedOrders.value[id] = true;
  await nextTick();
  document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};
const expandedOrders = ref<Record<string, boolean>>({});
const defaultExpandedId = computed(() => nextOrder.value?.id);
const isQrExpanded = (id: string) => expandedOrders.value[id] ?? id === defaultExpandedId.value;
const toggleQr = (id: string) => { expandedOrders.value[id] = !isQrExpanded(id); };
const activeTab = ref('all');
const matchesTab = (order: Order, tab: string) => {
  const status = displayStatus(order);
  return tab === 'all' || (tab === 'closed' ? status === 'CANCELLED' || status === 'EXPIRED' : status === tab);
};
const statusTabs = computed(() => [
  { value: 'all', label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ thanh toán' },
  { value: 'CONFIRMED', label: 'Đã xác nhận' },
  { value: 'closed', label: 'Đã huỷ/Hết hạn' },
].map(tab => ({ ...tab, count: orderStore.orders.filter(order => matchesTab(order, tab.value)).length })));
const visibleOrders = computed(() => orderStore.orders.filter(order => matchesTab(order, activeTab.value)));
const copyOrderId = async (id: string) => {
  try {
    await navigator.clipboard.writeText(id);
    toastStore.success('Đã sao chép mã đơn');
  } catch {
    toastStore.error('Không thể sao chép mã đơn. Vui lòng thử lại.');
  }
};
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 text-foreground sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Vé của tôi</h1>
        <p v-if="loaded && !orderStore.loading && !errorMessage && summary" class="mt-2 text-sm text-muted-foreground">{{ summary }}</p>
      </header>

      <Tabs v-model="activeTab" class="min-w-0 gap-5">
        <TabsList aria-label="Lọc đơn theo trạng thái" class="grid h-auto! w-full grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-4">
          <TabsTrigger v-for="tab in statusTabs" :key="tab.value" :value="tab.value" class="min-w-0 gap-1.5 px-2 py-2.5 text-xs sm:text-sm">
            {{ tab.label }} <span class="text-muted-foreground tabular-nums">{{ tab.count }}</span>
          </TabsTrigger>
        </TabsList>
        <p v-if="orderStore.pagination.totalPages > 1" class="text-xs text-muted-foreground">Số đếm tính trên các đơn của trang này.</p>
        <TabsContent :value="activeTab" class="min-w-0 space-y-5">
          <div v-if="orderStore.loading || !loaded" role="status" aria-label="Đang tải vé" class="space-y-5">
            <div v-for="n in 3" :key="n" class="grid rounded-lg border bg-background sm:grid-cols-[176px_minmax(0,1fr)_200px]">
              <Skeleton class="aspect-[16/9] w-full rounded-t-lg sm:aspect-auto sm:min-h-40 sm:rounded-l-lg sm:rounded-tr-none" />
              <div class="space-y-4 p-5"><Skeleton class="h-3 w-20" /><Skeleton class="h-6 w-4/5" /><Skeleton class="h-4 w-3/5" /><Skeleton class="h-4 w-2/5" /></div>
              <div class="space-y-4 border-t border-dashed p-5 sm:border-t-0 sm:border-l"><Skeleton class="h-5 w-24" /><Skeleton class="h-8 w-32" /><Skeleton class="h-10 w-full" /></div>
            </div>
          </div>
          <Card v-else-if="errorMessage" role="alert" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg p-8 text-center">
            <AlertCircle class="size-10 text-danger" aria-hidden="true" />
            <div><h2 class="font-semibold">Không tải được danh sách vé</h2><p class="mt-2 break-words text-sm text-muted-foreground">{{ errorMessage }}</p></div>
            <Button @click="loadOrders(orderStore.pagination.page, orderStore.pagination.limit)">Thử lại</Button>
          </Card>
          <Card v-else-if="visibleOrders.length === 0" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg px-5 py-12 text-center">
            <div><h2 class="text-lg font-semibold tracking-tight">{{ orderStore.orders.length === 0 ? 'Bạn chưa có vé nào' : 'Không có đơn nào ở mục này' }}</h2>
              <p class="mt-2 text-sm text-muted-foreground">{{ orderStore.orders.length === 0 ? 'Vé đã đặt sẽ xuất hiện ở đây.' : 'Chọn mục khác để xem các đơn đã đặt.' }}</p></div>
            <Button @click="router.push({ name: 'Home' })">Khám phá sự kiện</Button>
          </Card>
          <div v-else class="space-y-5">
            <section v-if="activeTab === 'all' && nextOrder" class="relative isolate aspect-square overflow-hidden rounded-lg bg-primary sm:aspect-[21/9] lg:aspect-[3/1]" aria-label="Sự kiện tiếp theo">
              <img v-if="imageOf(nextOrder)" :src="imageOf(nextOrder)!" alt="" class="absolute inset-0 h-full w-full object-cover" @error="failedImages.add(nextOrder.id)" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <TicketDate :value="eventOf(nextOrder)?.startTime" class="absolute left-3 top-3 sm:left-6 sm:top-6" />
              <div class="absolute inset-x-0 bottom-0 space-y-2 p-4 sm:p-6">
                <p class="text-xs font-semibold uppercase tracking-widest text-white/80">Sự kiện tiếp theo · {{ nextCountdown }}</p>
                <h2 class="line-clamp-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{{ eventOf(nextOrder)?.title }}</h2>
                <p class="line-clamp-2 text-sm text-white/85">{{ formatDateTime(eventOf(nextOrder)?.startTime) }} · {{ eventOf(nextOrder)?.location }}</p>
                <Button class="bg-background text-foreground hover:bg-background/90" @click="revealNextQr">Xem {{ nextOrder.tickets.length }} mã QR</Button>
              </div>
            </section>
            <article v-for="order in visibleOrders" :id="`order-${order.id}`" :key="order.id" class="group relative min-w-0 scroll-mt-6 rounded-lg border bg-background">
              <div class="grid min-w-0 sm:grid-cols-[176px_minmax(0,1fr)_200px]">
                <div class="relative aspect-[2/1] min-h-40 overflow-hidden rounded-t-lg bg-muted sm:aspect-auto sm:rounded-l-lg sm:rounded-tr-none">
                  <img v-if="imageOf(order)" :src="imageOf(order)!" alt="" loading="lazy" class="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none" :class="{ 'grayscale opacity-60': isClosed(order) }" @error="failedImages.add(order.id)" />
                  <div v-else class="absolute inset-0 flex items-center justify-center" :class="{ 'grayscale opacity-60': isClosed(order) }"><Ticket class="size-6 text-muted-foreground" aria-hidden="true" /></div>
                  <TicketDate :value="eventOf(order)?.startTime" class="absolute left-3 top-3" />
                </div>
                <div class="flex min-w-0 flex-col gap-3 p-5">
                  <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{{ categoryLabel(eventOf(order)?.category ?? 'OTHER') }}</p>
                  <h2 class="break-words text-lg font-semibold tracking-tight">
                    <RouterLink v-if="eventOf(order)?.slug" :to="`/events/${eventOf(order)?.slug}`" class="underline-offset-4 hover:underline">{{ eventOf(order)?.title }}</RouterLink>
                    <template v-else>{{ eventOf(order)?.title || 'Sự kiện' }}</template>
                  </h2>
                  <p v-if="eventOf(order)?.startTime" class="flex items-start gap-2 text-sm text-muted-foreground"><CalendarDays class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ formatDateTime(eventOf(order)?.startTime) }}</p>
                  <p v-if="eventOf(order)?.location" class="flex min-w-0 items-start gap-2 text-sm text-muted-foreground"><MapPin class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span class="min-w-0 break-words">{{ eventOf(order)?.location }}</span></p>
                  <p class="break-words text-sm">{{ groupTickets(order).map(line => `${line.name} × ${line.quantity}`).join(' · ') }}</p>
                  <div class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span class="tabular-nums">#{{ order.id.slice(0, 8).toUpperCase() }}</span>
                    <Button variant="ghost" size="icon" class="size-7" :aria-label="`Sao chép mã đơn ${order.id.slice(0, 8).toUpperCase()}`" title="Sao chép mã đơn" @click="copyOrderId(order.id)"><Copy class="size-3.5" aria-hidden="true" /></Button>
                    <span>Đặt lúc {{ formatDateTime(order.createdAt) }}</span>
                  </div>
                </div>
                <div class="relative flex min-w-0 flex-col gap-4 border-t border-dashed p-5 sm:border-t-0 sm:border-l">
                  <span aria-hidden="true" class="absolute -left-2 -top-2 size-4 rounded-full border bg-surface" />
                  <span aria-hidden="true" class="absolute -right-2 -top-2 size-4 rounded-full border bg-surface sm:-bottom-2 sm:-left-2 sm:top-auto sm:right-auto" />
                  <div class="flex flex-wrap items-center gap-2"><OrderStatusBadge :status="displayStatus(order)" /><Badge v-if="route.query.order === order.id" variant="outline">Vừa đặt</Badge></div>
                  <div>
                    <p v-if="hasDiscount(order)" class="flex flex-wrap gap-x-2 text-xs tabular-nums"><span class="text-muted-foreground line-through">{{ formatPrice(order.subtotalAmount) }}</span><span class="text-success">Giảm {{ formatPrice(order.discountAmount) }}</span></p>
                    <p class="break-words text-2xl font-bold tabular-nums" :class="{ 'text-muted-foreground': isClosed(order) }">{{ formatPrice(order.totalAmount) }}</p>
                  </div>
                  <div v-if="order.status === 'PENDING'" class="mt-auto space-y-2">
                    <p v-if="isHoldExpired(order)" class="text-sm text-muted-foreground">Đã hết thời gian giữ vé</p>
                    <template v-else>
                      <p class="flex items-start gap-2 text-sm"><Timer class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" /><span>Giữ vé còn <span class="font-semibold tabular-nums">{{ formatCountdown(remainingMs(order)) }}</span></span></p>
                      <Button class="min-h-10 w-full bg-brand text-brand-foreground hover:bg-brand/90" :disabled="!!actionOrderId" @click="router.push({ name: 'Checkout', params: { orderId: order.id } })">Thanh toán</Button>
                      <Button variant="ghost" size="sm" class="min-h-10 w-full text-danger hover:text-danger" :disabled="!!actionOrderId" @click="askCancel(order)">Huỷ đơn</Button>
                    </template>
                  </div>
                  <Button v-else-if="order.status === 'CONFIRMED'" variant="outline" class="mt-auto min-h-10 w-full" :aria-expanded="isQrExpanded(order.id)" :aria-controls="`order-tickets-${order.id}`" @click="toggleQr(order.id)"><QrCode class="size-4" aria-hidden="true" />Xem {{ order.tickets.length }} vé<ChevronDown class="size-4 transition-transform duration-200 motion-reduce:transition-none" :class="{ 'rotate-180': isQrExpanded(order.id) }" aria-hidden="true" /></Button>
                  <Button v-else-if="eventOf(order)?.slug" variant="ghost" as-child class="mt-auto min-h-10 w-full"><RouterLink :to="`/events/${eventOf(order)?.slug}`">Xem sự kiện</RouterLink></Button>
                </div>
              </div>
              <section v-if="order.status === 'CONFIRMED'" v-show="isQrExpanded(order.id)" :id="`order-tickets-${order.id}`" class="rounded-b-lg border-t bg-surface p-5 sm:p-6">
                <h3 class="font-semibold">Mã QR vào cổng</h3>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">Xuất trình mã này khi soát vé. Mỗi vé có một mã riêng.</p>
                <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  <div v-for="(ticket, index) in order.tickets" :key="ticket.id" class="flex min-w-0 flex-col items-center rounded-lg border bg-background p-3">
                    <p class="mb-2 text-xs font-medium">Vé {{ index + 1 }}</p>
                    <Badge variant="outline" class="mb-3 h-auto max-w-full whitespace-normal py-1 text-center leading-snug" :class="ticket.checkedInAt ? 'border-success/30 bg-success/10 text-success' : 'text-muted-foreground'">
                      {{ ticket.checkedInAt ? `Đã check-in lúc ${formatDateTime(ticket.checkedInAt)}` : 'Chưa check-in' }}
                    </Badge>
                    <QrCodeImage v-if="ticket.qrCode" :value="ticket.qrCode" :size="132" />
                    <p v-else class="py-6 text-center text-xs text-muted-foreground">Chưa có mã QR</p>
                    <Button v-if="ticket.qrCode" variant="ghost" size="sm" class="mt-2 text-primary" :aria-label="`Xem lớn mã QR vé ${index + 1}`" @click="openQr(order, ticket)">Xem lớn</Button>
                  </div>
                </div>
              </section>
            </article>
          </div>
        </TabsContent>
      </Tabs>

      <nav v-if="orderStore.pagination.totalPages > 1 && orderStore.orders.length > 0" aria-label="Phân trang đơn vé" class="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p class="text-sm text-muted-foreground">Tổng <strong class="text-foreground tabular-nums">{{ orderStore.pagination.total }}</strong> đơn</p>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" :disabled="orderStore.pagination.page === 1 || orderStore.loading" @click="changePage(orderStore.pagination.page - 1)">Trang trước</Button>
          <span class="text-xs text-muted-foreground tabular-nums">Trang {{ orderStore.pagination.page }} / {{ orderStore.pagination.totalPages }}</span>
          <Button variant="outline" size="sm" :disabled="orderStore.pagination.page === orderStore.pagination.totalPages || orderStore.loading" @click="changePage(orderStore.pagination.page + 1)">Trang sau</Button>
        </div>
      </nav>
    </div>

    <ConfirmDialog :open="cancelTarget !== null" title="Huỷ đơn hàng?" :message="cancelMessage" confirm-label="Huỷ đơn" cancel-label="Giữ lại" danger :loading="cancelLoading" @cancel="cancelTarget = null" @confirm="handleCancel" />
    <Dialog :open="selectedQr !== null" @update:open="(open) => { if (!open) selectedQr = null; }">
      <DialogContent class="max-w-sm rounded-lg">
        <template v-if="selectedQr">
          <DialogHeader><DialogTitle class="break-words pr-6">{{ selectedQr.label }}</DialogTitle><DialogDescription>Xuất trình mã QR này tại cổng soát vé.</DialogDescription></DialogHeader>
          <QrCodeImage :value="selectedQr.qrCode" :size="288" :download-name="selectedQr.filename" />
          <p class="break-all text-center text-xs text-muted-foreground">{{ selectedQr.qrCode }}</p>
          <Button variant="outline" class="w-full" @click="selectedQr = null">Đóng</Button>
        </template>
      </DialogContent>
    </Dialog>
  </main>
</template>
