<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import type { TicketType } from '../stores/event';
import { useOrderStore } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import { formatPrice, formatDateTime } from '../utils/format';
import AppAlert from '../components/AppAlert.vue';
import EventBanner from '../components/EventBanner.vue';

const route = useRoute();
const router = useRouter();
const eventStore = useEventStore();
const orderStore = useOrderStore();
const authStore = useAuthStore();

const loadError = ref('');
const errorMessage = ref('');
const submittingId = ref<string | null>(null);

/** Số lượng vé user chọn cho từng loại vé, key = ticketTypeId */
const quantities = ref<Record<string, number>>({});

const loadEvent = async (id: string) => {
  loadError.value = '';
  errorMessage.value = '';

  try {
    const event = await eventStore.fetchEventById(id);

    if (!event) {
      loadError.value = 'Không tìm thấy sự kiện này!';
      return;
    }

    // Mặc định mỗi loại vé chọn 1
    quantities.value = Object.fromEntries(
      (event.ticketTypes ?? []).map((ticket) => [ticket.id, 1])
    );
  } catch (error: any) {
    loadError.value =
      error.response?.status === 404
        ? 'Không tìm thấy sự kiện này!'
        : error.response?.data?.message || 'Không tải được thông tin sự kiện!';
  }
};

onMounted(() => loadEvent(String(route.params.id)));

// Điều hướng từ /events/a -> /events/b sẽ tái sử dụng component này,
// nên phải theo dõi param để load lại dữ liệu.
watch(
  () => route.params.id,
  (newId) => {
    if (newId) loadEvent(String(newId));
  }
);

/**
 * Ô số lượng là type="number" nên khi user xoá trắng, v-model.number trả về ''.
 * Không chuẩn hoá lại thì bấm "Đặt vé" sẽ ăn thông báo lỗi khó hiểu.
 * Blur ra ngoài -> kéo về khoảng hợp lệ [1, availableQuantity].
 */
const normalizeQuantity = (ticket: TicketType) => {
  const parsed = Math.floor(Number(quantities.value[ticket.id]));
  const upperBound = Math.max(1, ticket.availableQuantity);

  quantities.value[ticket.id] =
    !Number.isFinite(parsed) || parsed < 1 ? 1 : Math.min(parsed, upperBound);
};

const handleBook = async (ticket: TicketType) => {
  errorMessage.value = '';

  // POST /orders yêu cầu Bearer token -> chưa đăng nhập thì đẩy sang login
  // kèm `redirect` để sau khi đăng nhập quay lại đúng sự kiện này.
  if (!authStore.isAuthenticated) {
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }

  const quantity = quantities.value[ticket.id] ?? 1;

  if (!Number.isInteger(quantity) || quantity < 1) {
    errorMessage.value = 'Số lượng vé phải là số nguyên lớn hơn 0!';
    return;
  }

  if (quantity > ticket.availableQuantity) {
    errorMessage.value = `Chỉ còn ${ticket.availableQuantity} vé cho loại "${ticket.name}"!`;
    return;
  }

  submittingId.value = ticket.id;

  try {
    await orderStore.createOrder(ticket.id, quantity);
    // Thành công -> sang trang "Vé của tôi", đơn mới nằm ngay đầu danh sách
    router.push({ name: 'MyOrders' });
  } catch (error: any) {
    const status = error.response?.status;

    // Token hết hạn/hỏng: dọn state rồi bắt đăng nhập lại
    if (status === 401 || status === 403) {
      authStore.logout();
      router.push({ name: 'Login', query: { redirect: route.fullPath } });
      return;
    }

    // 400 (hết vé, số lượng sai) và 429 (quá tải do Redlock)
    // đều đã có message tiếng Việt sẵn từ BE -> hiển thị thẳng.
    errorMessage.value =
      error.response?.data?.message || 'Đặt vé thất bại, vui lòng thử lại!';
  } finally {
    submittingId.value = null;
  }
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-16">
    <!-- Đang tải -->
    <div v-if="eventStore.loading && !eventStore.currentEvent" class="max-w-5xl mx-auto px-4 py-8">
      <div class="h-64 bg-gray-200 rounded-2xl animate-pulse"></div>
      <div class="mt-6 h-8 w-2/3 bg-gray-200 rounded animate-pulse"></div>
      <div class="mt-3 h-4 w-1/3 bg-gray-200 rounded animate-pulse"></div>
    </div>

    <!-- Không tìm thấy / lỗi tải -->
    <div v-else-if="loadError" class="max-w-5xl mx-auto px-4 py-20 text-center">
      <h1 class="text-2xl font-bold text-gray-900">{{ loadError }}</h1>
      <button
        class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        @click="router.push({ name: 'Home' })"
      >
        Về trang chủ
      </button>
    </div>

    <!-- Nội dung -->
    <div v-else-if="eventStore.currentEvent" class="max-w-5xl mx-auto px-4 py-8">
      <!-- Quay lại -->
      <button
        class="mb-4 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
        @click="router.push({ name: 'Home' })"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        Quay lại danh sách sự kiện
      </button>

      <!-- Banner (tự fallback nếu ảnh lỗi/không có) -->
      <div class="relative h-64 sm:h-80 rounded-2xl overflow-hidden bg-gray-100">
        <EventBanner
          :src="eventStore.currentEvent.bannerUrl"
          :alt="eventStore.currentEvent.title"
        />
      </div>

      <h1 class="mt-6 text-3xl font-extrabold text-gray-900 tracking-tight">
        {{ eventStore.currentEvent.title }}
      </h1>

      <!-- Thông tin sự kiện -->
      <div class="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm text-gray-600">
        <p>
          <span class="font-semibold text-gray-900">Bắt đầu:</span>
          {{ formatDateTime(eventStore.currentEvent.startTime) }}
        </p>
        <p>
          <span class="font-semibold text-gray-900">Kết thúc:</span>
          {{ formatDateTime(eventStore.currentEvent.endTime) }}
        </p>
        <p>
          <span class="font-semibold text-gray-900">Địa điểm:</span>
          {{ eventStore.currentEvent.location }}
        </p>
        <p v-if="eventStore.currentEvent.organizer">
          <span class="font-semibold text-gray-900">Ban tổ chức:</span>
          {{ eventStore.currentEvent.organizer.fullName }}
        </p>
      </div>

      <p v-if="eventStore.currentEvent.description" class="mt-6 text-gray-700 leading-relaxed whitespace-pre-line">
        {{ eventStore.currentEvent.description }}
      </p>

      <!-- Chọn vé -->
      <section class="mt-10">
        <h2 class="text-xl font-bold text-gray-900">Chọn loại vé</h2>

        <AppAlert :message="errorMessage" type="error" class="mt-4" />

        <p
          v-if="!eventStore.currentEvent.ticketTypes?.length"
          class="mt-4 text-sm text-gray-500 bg-white border border-gray-100 rounded-xl p-6"
        >
          Sự kiện này chưa mở bán loại vé nào.
        </p>

        <div v-else class="mt-4 space-y-4">
          <div
            v-for="ticket in eventStore.currentEvent.ticketTypes"
            :key="ticket.id"
            class="bg-white border border-gray-100 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div class="flex-1">
              <h3 class="font-bold text-gray-900">{{ ticket.name }}</h3>
              <p class="mt-1 text-sm text-gray-500">
                Còn lại
                <strong :class="ticket.availableQuantity > 0 ? 'text-green-600' : 'text-red-500'">
                  {{ ticket.availableQuantity }}
                </strong>
                / {{ ticket.totalQuantity }} vé
              </p>
            </div>

            <p class="text-lg font-extrabold text-indigo-600 whitespace-nowrap">
              {{ formatPrice(ticket.price) }}
            </p>

            <div class="flex items-center gap-3">
              <input
                v-model.number="quantities[ticket.id]"
                type="number"
                min="1"
                :max="ticket.availableQuantity"
                :disabled="ticket.availableQuantity <= 0"
                class="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                @blur="normalizeQuantity(ticket)"
              />

              <button
                :disabled="ticket.availableQuantity <= 0 || submittingId === ticket.id"
                class="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                @click="handleBook(ticket)"
              >
                <span v-if="submittingId === ticket.id">Đang xử lý...</span>
                <span v-else-if="ticket.availableQuantity <= 0">Hết vé</span>
                <span v-else>Đặt vé</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
