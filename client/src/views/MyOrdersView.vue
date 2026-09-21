<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useOrderStore } from '../stores/order';
import type { Order, OrderStatus } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import { formatPrice, formatDateTime } from '../utils/format';

const route = useRoute();
const router = useRouter();
const orderStore = useOrderStore();
const authStore = useAuthStore();

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

onMounted(loadOrders);

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

      <!-- Đang tải (gộp !loaded để lần render đầu cũng hiện skeleton) -->
      <div v-if="orderStore.loading || !loaded" class="space-y-4">
        <div v-for="n in 3" :key="n" class="bg-white rounded-xl h-40 animate-pulse border border-gray-100"></div>
      </div>

      <!-- Lỗi tải -->
      <div v-else-if="errorMessage" class="text-center py-16 bg-white rounded-2xl border border-gray-100">
        <h3 class="text-lg font-bold text-gray-900">Không tải được đơn vé</h3>
        <p class="mt-1 text-sm text-gray-500">{{ errorMessage }}</p>
        <button
          class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          @click="loadOrders"
        >
          Thử lại
        </button>
      </div>

      <!-- Chưa có đơn nào -->
      <div
        v-else-if="orderStore.orders.length === 0"
        class="text-center py-16 bg-white rounded-2xl border border-gray-100"
      >
        <h3 class="text-lg font-bold text-gray-900">Bạn chưa có đơn vé nào</h3>
        <p class="mt-1 text-sm text-gray-500">Hãy khám phá các sự kiện đang mở bán nhé.</p>
        <button
          class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          @click="router.push({ name: 'Home' })"
        >
          Xem sự kiện
        </button>
      </div>

      <!-- Danh sách đơn -->
      <div v-else class="space-y-4">
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
              :class="statusClass[order.status]"
            >
              {{ statusLabel[order.status] }}
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

          <footer class="px-5 py-4 bg-gray-50 flex items-center justify-between">
            <span class="text-sm text-gray-600">Tổng tiền</span>
            <span class="text-lg font-extrabold text-indigo-600">
              {{ formatPrice(order.totalAmount) }}
            </span>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>
