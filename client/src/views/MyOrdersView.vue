<script setup lang="ts">
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
// sẽ nháy lên "Bạn chưa có đơn vé nào" dù user đang có đơn.
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  // Cổng thanh toán đang bật: công khai, tải một lần để render nút theo cổng.
  orderStore.loadPaymentProviders();
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

const handleConfirm = async (order: Order) => {
  if (actionOrderId.value) return;

  actionOrderId.value = order.id;
  try {
    const response = await orderStore.confirmOrder(order.id);
    toastStore.success(response.message || 'Thanh toán thành công!');
  } catch (error: any) {
    await handleActionError(error, 'Thanh toán thất bại, vui lòng thử lại!');
  } finally {
    actionOrderId.value = null;
  }
};

const paymentProviders = computed(() => orderStore.paymentProviders);

/**
 * Thanh toán qua VNPay/MoMo: BE trả paymentUrl -> rời trang app sang cổng
 * thanh toán. Đơn 0đ BE xác nhận luôn và trả `order` (store đã cập nhật tại
 * chỗ), khi đó chỉ cần báo thành công.
 */
const handlePay = async (order: Order, provider: 'VNPAY' | 'MOMO') => {
  if (actionOrderId.value) return;

  actionOrderId.value = order.id;
  try {
    const response = await orderStore.payOrder(order.id, provider);

    if (response.data?.paymentUrl) {
      window.location.href = response.data.paymentUrl;
      return;
    }

    toastStore.success(response.message || 'Thanh toán thành công, vé đã được gửi tới email của bạn!');
  } catch (error: any) {
    await handleActionError(error, 'Không tạo được phiên thanh toán, vui lòng thử lại!');
  } finally {
    actionOrderId.value = null;
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
const selectedQr = ref<{ qrCode: string; label: string } | null>(null);

const openQr = (order: Order, ticket: OrderTicket) => {
  if (!ticket.qrCode) return;

  const position = order.tickets.findIndex((item) => item.id === ticket.id) + 1;
  selectedQr.value = {
    qrCode: ticket.qrCode,
    label: `${ticket.ticketType?.name ?? 'Vé'} · Vé ${position}/${order.tickets.length}`,
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
// API chưa trả endTime, chỉ tự mở khi chắc chắn sự kiện chưa bắt đầu.
const expandedOrders = ref<Record<string, boolean>>({});
const defaultExpandedId = computed(() => orderStore.orders.find(order => order.status === 'CONFIRMED' && new Date(order.tickets[0]?.ticketType?.event?.startTime ?? '').getTime() > now.value)?.id);
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
const ticketBorder = (order: Order) => ({
  PENDING: 'border-l-warning', CONFIRMED: 'border-l-success',
  CANCELLED: 'border-l-danger', EXPIRED: 'border-l-muted-foreground',
})[displayStatus(order)];

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
    <div class="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Vé của tôi</h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Quản lý đơn đặt vé, thanh toán và lưu mã QR cho những trải nghiệm sắp tới.</p>
      </header>

      <Tabs v-model="activeTab" class="min-w-0 gap-5">
        <TabsList aria-label="Lọc đơn theo trạng thái" class="grid h-auto! w-full grid-cols-2 gap-1 rounded-lg p-1 sm:grid-cols-4">
          <TabsTrigger v-for="tab in statusTabs" :key="tab.value" :value="tab.value" class="min-w-0 gap-1.5 px-2 py-2.5 text-xs sm:text-sm">
            {{ tab.label }} <Badge variant="secondary" class="px-1.5 tabular-nums">{{ tab.count }}</Badge>
          </TabsTrigger>
        </TabsList>
        <p v-if="orderStore.pagination.totalPages > 1" class="text-xs text-muted-foreground">Số đếm tính trên các đơn của trang này.</p>
        <TabsContent :value="activeTab" class="min-w-0 space-y-5">
          <div v-if="orderStore.loading || !loaded" role="status" aria-label="Đang tải vé" class="space-y-5">
            <Card v-for="n in 3" :key="n" class="shadow-none ring-0 border border-border bg-background gap-5 rounded-lg border-l-4 border-l-muted-foreground p-5">
              <div class="flex justify-between gap-4"><Skeleton class="h-6 w-3/5" /><Skeleton class="h-6 w-20" /></div>
              <Skeleton class="h-4 w-2/5" /><Skeleton class="h-12 w-full" />
              <div class="flex justify-end border-t border-dashed pt-5"><Skeleton class="h-8 w-32" /></div>
            </Card>
          </div>
          <Card v-else-if="errorMessage" role="alert" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg p-8 text-center">
            <AlertCircle class="size-10 text-danger" aria-hidden="true" />
            <div><h2 class="font-semibold">Không tải được danh sách vé</h2><p class="mt-2 break-words text-sm text-muted-foreground">{{ errorMessage }}</p></div>
            <Button @click="loadOrders(orderStore.pagination.page, orderStore.pagination.limit)">Thử lại</Button>
          </Card>
          <Card v-else-if="visibleOrders.length === 0" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg px-5 py-12 text-center">
            <div class="rounded-lg bg-primary/5 p-4"><Ticket class="size-9 text-primary" aria-hidden="true" /></div>
            <div><h2 class="text-lg font-semibold tracking-tight">{{ orderStore.orders.length === 0 ? 'Bạn chưa có đơn vé nào' : 'Chưa có đơn vé ở trạng thái này' }}</h2>
              <p class="mt-2 text-sm text-muted-foreground">{{ orderStore.orders.length === 0 ? 'Khám phá sự kiện yêu thích và đặt vé cho trải nghiệm tiếp theo.' : 'Chọn trạng thái khác hoặc khám phá thêm các sự kiện đang mở bán.' }}</p></div>
            <Button @click="router.push({ name: 'Home' })">Khám phá sự kiện</Button>
          </Card>
          <div v-else class="space-y-5">
            <Card v-for="order in visibleOrders" :key="order.id" class="shadow-none ring-0 border border-border bg-background gap-0 rounded-lg border-l-4 py-0 transition-colors" :class="ticketBorder(order)">
              <header class="flex flex-col gap-4 p-5 sm:flex-row sm:justify-between sm:p-6">
                <div class="min-w-0 space-y-2">
                  <h2 class="break-words text-lg font-semibold tracking-tight">{{ order.tickets[0]?.ticketType?.event?.title || 'Sự kiện' }}</h2>
                  <p v-if="order.tickets[0]?.ticketType?.event?.startTime" class="flex items-start gap-2 text-sm text-muted-foreground"><CalendarDays class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ formatDateTime(order.tickets[0]!.ticketType!.event!.startTime) }}</p>
                  <p v-if="order.tickets[0]?.ticketType?.event?.location" class="flex items-start gap-2 break-words text-sm text-muted-foreground"><MapPin class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span class="min-w-0 break-words">{{ order.tickets[0]?.ticketType?.event?.location }}</span></p>
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span class="tabular-nums">#{{ order.id.slice(0, 8).toUpperCase() }}</span>
                    <Button variant="ghost" size="icon" class="size-7" :aria-label="`Sao chép mã đơn ${order.id.slice(0, 8).toUpperCase()}`" title="Sao chép mã đơn" @click="copyOrderId(order.id)"><Copy class="size-3.5" aria-hidden="true" /></Button>
                    <span>Đặt lúc {{ formatDateTime(order.createdAt) }}</span>
                  </div>
                </div>
                <div class="shrink-0"><OrderStatusBadge :status="displayStatus(order)" /></div>
              </header>
              <div class="space-y-4 px-5 pb-5 sm:px-6">
                <div v-for="line in groupTickets(order)" :key="line.id" class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-sm">
                  <div class="min-w-0"><p class="break-words font-medium">{{ line.name }} × {{ line.quantity }}</p><p class="mt-1 text-xs text-muted-foreground tabular-nums">Đơn giá {{ formatPrice(line.price) }}</p></div>
                  <p class="text-right font-medium tabular-nums">{{ formatPrice(Number(line.price) * line.quantity) }}</p>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 border-t border-dashed px-5 py-5 sm:px-6">
                <span class="text-sm text-muted-foreground">Tổng tiền</span>
                <div class="ml-auto flex flex-col items-end gap-1">
                  <p v-if="hasDiscount(order)" class="flex flex-wrap items-center justify-end gap-x-2 text-xs tabular-nums">
                    <span class="text-muted-foreground line-through">{{ formatPrice(order.subtotalAmount) }}</span>
                    <span class="font-medium text-success">Giảm {{ formatPrice(order.discountAmount) }}</span>
                  </p>
                  <span class="text-right text-2xl font-semibold tracking-tight text-primary tabular-nums">{{ formatPrice(order.totalAmount) }}</span>
                </div>
              </div>
              <div v-if="order.status === 'PENDING'" class="mx-5 mb-5 rounded-lg border border-warning/25 bg-warning/10 p-4 sm:mx-6 sm:mb-6">
                <p v-if="isHoldExpired(order)" class="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Timer class="size-4 shrink-0" aria-hidden="true" />Đã hết hạn giữ chỗ</p>
                <template v-else>
                  <p class="flex items-center gap-2 text-sm font-medium"><Timer class="size-4 shrink-0 text-warning" aria-hidden="true" /><span>Còn <span class="font-semibold tabular-nums">{{ formatCountdown(remainingMs(order)) }}</span> để thanh toán</span></p>
                  <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button v-if="paymentProviders.includes('VNPAY')" class="bg-brand text-brand-foreground hover:bg-brand/90" :disabled="actionOrderId === order.id" @click="handlePay(order, 'VNPAY')">{{ actionOrderId === order.id ? 'Đang xử lý...' : 'Thanh toán VNPay' }}</Button>
                    <Button v-if="paymentProviders.includes('MOMO')" class="bg-brand text-brand-foreground hover:bg-brand/90" :disabled="actionOrderId === order.id" @click="handlePay(order, 'MOMO')">{{ actionOrderId === order.id ? 'Đang xử lý...' : 'Thanh toán MoMo' }}</Button>
                    <Button v-if="paymentProviders.includes('MOCK')" variant="outline" :disabled="actionOrderId === order.id" @click="handleConfirm(order)">{{ actionOrderId === order.id ? 'Đang xử lý...' : 'Thanh toán thử' }}</Button>
                    <Button variant="outline" class="border-danger/30 bg-background text-danger hover:bg-danger/10 hover:text-danger" :disabled="actionOrderId === order.id" @click="askCancel(order)">Huỷ đơn</Button>
                  </div>
                </template>
              </div>
              <section v-if="order.status === 'CONFIRMED'" class="border-t bg-surface/60 p-5 sm:p-6">
                <Button variant="outline" :aria-expanded="isQrExpanded(order.id)" :aria-controls="`order-tickets-${order.id}`" @click="toggleQr(order.id)"><QrCode aria-hidden="true" />Xem {{ order.tickets.length }} vé<ChevronDown :class="{ 'rotate-180': isQrExpanded(order.id) }" aria-hidden="true" /></Button>
                <div v-show="isQrExpanded(order.id)" :id="`order-tickets-${order.id}`" class="mt-4">
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
                </div>
              </section>
            </Card>
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
          <QrCodeImage :value="selectedQr.qrCode" :size="288" />
          <p class="break-all text-center text-xs text-muted-foreground">{{ selectedQr.qrCode }}</p>
          <Button variant="outline" class="w-full" @click="selectedQr = null">Đóng</Button>
        </template>
      </DialogContent>
    </Dialog>
  </main>
</template>
