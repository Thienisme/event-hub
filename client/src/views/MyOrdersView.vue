<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrderStore } from '../stores/order';
import type { Order, OrderStatus, OrderTicket } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import { useToastStore } from '../stores/toast';
import { formatPrice, formatDateTime } from '../utils/format';
import DataState from '../components/DataState.vue';
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

const loadOrders = async () => {
  errorMessage.value = '';
  try {
    await orderStore.fetchMyOrders();
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

/**
 * Đồng hồ đếm ngược dùng chung cho mọi đơn PENDING: một interval cập nhật
 * `now`, mỗi đơn tự tính phần còn lại. Nhờ vậy không phải tạo/thu dọn timer
 * cho từng đơn khi danh sách đổi.
 */
const now = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  loadOrders();
  countdownTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});

const statusLabel: Record<OrderStatus, string> = {
  PENDING: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
};

const statusClass: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  CONFIRMED: 'bg-green-50 text-green-700 border-green-200',
  CANCELLED: 'bg-red-50 text-red-600 border-red-200',
  EXPIRED: 'bg-gray-100 text-gray-600 border-gray-200',
};

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
      await orderStore.fetchMyOrders();
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
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">Vé của tôi</h1>
        <p class="mt-1 text-sm text-gray-500">Danh sách đơn đặt vé của bạn</p>
      </div>

      <!-- Đang tải / lỗi / rỗng / có dữ liệu — dùng chung component DataState -->
      <DataState
        :loading="orderStore.loading"
        :loaded="loaded"
        :error="errorMessage"
        :empty="orderStore.orders.length === 0"
        empty-title="Bạn chưa có đơn vé nào"
        empty-description="Hãy khám phá các sự kiện đang mở bán nhé."
        empty-action-label="Xem sự kiện"
        @retry="loadOrders"
        @empty-action="router.push({ name: 'Home' })"
      >
        <template #skeleton>
          <div class="space-y-4">
            <div v-for="n in 3" :key="n" class="bg-white rounded-xl h-40 animate-pulse border border-gray-100"></div>
          </div>
        </template>

        <!-- Danh sách đơn -->
        <div class="space-y-4">
          <article
            v-for="order in orderStore.orders"
            :key="order.id"
            class="bg-white border border-gray-100 rounded-xl overflow-hidden"
          >
            <header class="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-xs text-gray-500">Mã đơn</p>
                <p class="font-mono text-sm font-semibold text-gray-900">
                  #{{ order.id.slice(0, 8).toUpperCase() }}
                </p>
                <p class="mt-1 text-xs text-gray-500">Đặt lúc {{ formatDateTime(order.createdAt) }}</p>
              </div>

              <span
                class="px-3 py-1 text-xs font-semibold rounded-full border"
                :class="statusClass[displayStatus(order)]"
              >
                {{ statusLabel[displayStatus(order)] }}
              </span>
            </header>

            <div class="px-5 py-4 space-y-3">
              <div
                v-for="line in groupTickets(order)"
                :key="line.id"
                class="flex items-center justify-between text-sm"
              >
                <div>
                  <p class="font-medium text-gray-900">{{ line.name }} × {{ line.quantity }}</p>
                  <p v-if="line.event" class="text-xs text-gray-500">
                    {{ line.event.title }} — {{ line.event.location }}
                  </p>
                </div>
                <p class="text-gray-600">{{ formatPrice(line.price) }}</p>
              </div>
            </div>

            <!-- Chỉ đơn đã thanh toán mới có mã QR vào cổng -->
            <div
              v-if="order.status === 'CONFIRMED'"
              class="px-5 py-4 border-t border-gray-100"
            >
              <p class="text-sm font-semibold text-gray-900">Mã QR vào cổng</p>
              <p class="mt-1 text-xs text-gray-500">
                Xuất trình mã này khi soát vé. Mỗi vé có một mã riêng.
              </p>

              <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                <div
                  v-for="(ticket, index) in order.tickets"
                  :key="ticket.id"
                  class="border border-gray-100 rounded-lg p-3 flex flex-col items-center"
                >
                  <QrCodeImage v-if="ticket.qrCode" :value="ticket.qrCode" :size="132" />
                  <p v-else class="py-6 text-xs text-gray-400 text-center">Chưa có mã QR</p>

                  <p class="mt-2 text-xs text-gray-500">Vé {{ index + 1 }}</p>

                  <button
                    v-if="ticket.qrCode"
                    type="button"
                    class="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                    @click="openQr(order, ticket)"
                  >
                    Xem lớn
                  </button>
                </div>
              </div>
            </div>

            <footer class="px-5 py-4 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-baseline gap-2">
                <span class="text-sm text-gray-600">Tổng tiền</span>
                <span class="text-lg font-extrabold text-indigo-600">
                  {{ formatPrice(order.totalAmount) }}
                </span>
              </div>

              <!-- Chỉ đơn đang giữ chỗ mới có thao tác thanh toán/huỷ -->
              <div
                v-if="order.status === 'PENDING'"
                class="flex flex-wrap items-center gap-3"
              >
                <span
                  v-if="isHoldExpired(order)"
                  class="text-sm font-medium text-gray-500"
                >
                  Đã hết hạn giữ chỗ
                </span>

                <template v-else>
                  <span class="text-sm text-gray-600">
                    Giữ chỗ còn
                    <span class="font-mono font-semibold text-yellow-700">
                      {{ formatCountdown(remainingMs(order)) }}
                    </span>
                  </span>

                  <button
                    type="button"
                    :disabled="actionOrderId === order.id"
                    class="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="askCancel(order)"
                  >
                    Huỷ đơn
                  </button>

                  <button
                    type="button"
                    :disabled="actionOrderId === order.id"
                    class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="handleConfirm(order)"
                  >
                    <span v-if="actionOrderId === order.id">Đang xử lý...</span>
                    <span v-else>Thanh toán (giả lập)</span>
                  </button>
                </template>
              </div>
            </footer>
          </article>
        </div>
      </DataState>
    </div>

    <!-- Hỏi lại trước khi huỷ: huỷ đơn không hoàn tác được -->
    <ConfirmDialog
      :open="cancelTarget !== null"
      title="Huỷ đơn hàng?"
      :message="cancelMessage"
      confirm-label="Huỷ đơn"
      cancel-label="Giữ lại"
      danger
      :loading="cancelLoading"
      @cancel="cancelTarget = null"
      @confirm="handleCancel"
    />

    <!-- Xem mã QR lớn -->
    <Teleport to="body">
      <div
        v-if="selectedQr"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div
          class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
          @click="selectedQr = null"
        ></div>

        <div
          role="dialog"
          aria-modal="true"
          class="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 text-center space-y-4"
        >
          <h3 class="text-lg font-bold text-gray-900">{{ selectedQr.label }}</h3>

          <QrCodeImage :value="selectedQr.qrCode" :size="288" />

          <p class="font-mono text-xs text-gray-500 break-all">{{ selectedQr.qrCode }}</p>

          <button
            type="button"
            class="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            @click="selectedQr = null"
          >
            Đóng
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
