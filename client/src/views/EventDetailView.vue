<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import type { EventItem, TicketType } from '../stores/event';
import { useOrderStore } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import apiClient from '../api/axios';
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

const isDeleting = ref(false);
const deleteError = ref('');

/**
 * Dữ liệu sự kiện đang xem nằm ở ref CỤC BỘ, không đọc từ
 * `eventStore.currentEvent`.
 *
 * Lý do: `currentEvent` là state toàn cục của store. Điều hướng /events/a ->
 * /events/b sẽ tái sử dụng đúng component này, và store vẫn giữ sự kiện cũ cho
 * tới khi response mới về -> người dùng thấy nội dung của sự kiện A trong lúc
 * đang tải sự kiện B (rồi mới nhảy sang B). Giữ state ở view giữ cho mỗi lần
 * điều hướng luôn hiển thị đúng sự kiện đang xem.
 */
const event = ref<EventItem | null>(null);
const isLoading = ref(false);

/** Số lượng vé user chọn cho từng loại vé, key = ticketTypeId */
const quantities = ref<Record<string, number>>({});

// Huỷ request cũ khi đổi route nhanh (/events/a -> /events/b) để response
// của sự kiện cũ không về muộn và ghi đè sự kiện mới.
let eventAbort: AbortController | undefined;

const loadEvent = async (id: string) => {
  eventAbort?.abort();
  const controller = new AbortController();
  eventAbort = controller;

  loadError.value = '';
  errorMessage.value = '';
  // Xoá sự kiện đang hiển thị ngay lập tức: nếu giữ lại, lúc chờ response mới
  // người dùng vẫn nhìn thấy sự kiện cũ (và tưởng là dữ liệu bị sai).
  event.value = null;
  quantities.value = {};
  isLoading.value = true;

  try {
    const loaded = await eventStore.fetchEventById(id, controller.signal);

    if (!loaded) {
      loadError.value = 'Không tìm thấy sự kiện này!';
      return;
    }

    event.value = loaded;

    // Mặc định mỗi loại vé chọn 1
    quantities.value = Object.fromEntries(
      (loaded.ticketTypes ?? []).map((ticket) => [ticket.id, 1])
    );
  } catch (error: any) {
    // Request bị chính mình huỷ -> bỏ qua, không phải lỗi thật.
    if (error?.code === 'ERR_CANCELED') return;
    loadError.value =
      error.response?.status === 404
        ? 'Không tìm thấy sự kiện này!'
        : error.response?.data?.message || 'Không tải được thông tin sự kiện!';
  } finally {
    // Chỉ tắt loading nếu đây vẫn là request mới nhất: request cũ bị huỷ vẫn
    // chạy tới finally và không được tắt loading của request đang bay.
    if (eventAbort === controller) {
      isLoading.value = false;
    }
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

onUnmounted(() => {
  eventAbort?.abort();
});

/**
 * Ô số lượng là type="number" nên khi user xoá trắng, v-model.number trả về ''.
 * Không chuẩn hoá lại thì bấm "Đặt vé" sẽ ăn thông báo lỗi khó hiểu.
 * Blur ra ngoài -> kéo về khoảng hợp lệ [1, availableQuantity].
 */
const normalizeQuantity = (ticket: TicketType) => {
  // Hết vé: không có khoảng hợp lệ nào, đặt về 0 cho khỏi gợi ý người dùng
  // rằng còn vé (ô nhập đã bị disable nhưng vẫn cần giá trị nhất quán).
  if (ticket.availableQuantity <= 0) {
    quantities.value[ticket.id] = 0;
    return;
  }

  const parsed = Math.floor(Number(quantities.value[ticket.id]));

  quantities.value[ticket.id] =
    !Number.isFinite(parsed) || parsed < 1 ? 1 : Math.min(parsed, ticket.availableQuantity);
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

    // Token hết hạn/hỏng: dọn state rồi bắt đăng nhập lại.
    // Lưu ý: interceptor của axios đã báo 401 cho main.ts xử lý (điều hướng
    // sang /login kèm ?redirect=). Ở đây chỉ dọn state cho chắc.
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

const handleDelete = async () => {
  const id = route.params.id;
  if (!id) return;

  if (!confirm(`Bạn có chắc muốn xóa sự kiện "${event.value?.title}"?`)) {
    return;
  }

  isDeleting.value = true;
  deleteError.value = '';

  try {
    // Dùng apiClient: tự gắn token + tự xử lý 401 (điều fetch trần không làm).
    await apiClient.delete(`/events/${id}`);

    // Quay về trang chủ sau khi xóa thành công
    router.push({ name: 'Home' });
  } catch (error: any) {
    deleteError.value =
      error.response?.data?.message || 'Xóa sự kiện thất bại!';
  } finally {
    isDeleting.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-16">
    <!-- Đang tải -->
    <div v-if="isLoading" class="max-w-5xl mx-auto px-4 py-8">
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
    <div v-else-if="event" class="max-w-5xl mx-auto px-4 py-8">
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
        <EventBanner :src="event.bannerUrl" :alt="event.title" />
      </div>

      <!-- Nút quản lý sự kiện (chỉ hiển thị cho organizer/admin) -->
      <div v-if="authStore.isOrganizer" class="mt-4">
        <div class="flex items-center gap-3">
          <router-link
            :to="{ name: 'EditEvent', params: { id: event.id } }"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Chỉnh sửa sự kiện
          </router-link>
          <button
            :disabled="isDeleting"
            @click="handleDelete"
            class="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            <span v-if="isDeleting">Đang xóa...</span>
            <span v-else>Xóa sự kiện</span>
          </button>
        </div>

        <!-- Alert lỗi xóa nằm NGOÀI hàng flex: bên trong flex nó bị co lại theo
             nội dung và lệch hàng, nhìn rối. -->
        <AppAlert v-if="deleteError" :message="deleteError" type="error" class="mt-3" />
      </div>

      <h1 class="mt-6 text-3xl font-extrabold text-gray-900 tracking-tight">
        {{ event.title }}
      </h1>

      <!-- Thông tin sự kiện -->
      <div class="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm text-gray-600">
        <p>
          <span class="font-semibold text-gray-900">Bắt đầu:</span>
          {{ formatDateTime(event.startTime) }}
        </p>
        <p>
          <span class="font-semibold text-gray-900">Kết thúc:</span>
          {{ formatDateTime(event.endTime) }}
        </p>
        <p>
          <span class="font-semibold text-gray-900">Địa điểm:</span>
          {{ event.location }}
        </p>
        <p v-if="event.organizer">
          <span class="font-semibold text-gray-900">Ban tổ chức:</span>
          {{ event.organizer.fullName }}
        </p>
      </div>

      <p v-if="event.description" class="mt-6 text-gray-700 leading-relaxed whitespace-pre-line">
        {{ event.description }}
      </p>

      <!-- Chọn vé -->
      <section class="mt-10">
        <h2 class="text-xl font-bold text-gray-900">Chọn loại vé</h2>

        <AppAlert :message="errorMessage" type="error" class="mt-4 mb-4" />

        <p
          v-if="!event.ticketTypes?.length"
          class="mt-4 text-sm text-gray-500 bg-white border border-gray-100 rounded-xl p-6"
        >
          Sự kiện này chưa mở bán loại vé nào.
        </p>

        <div v-else class="mt-4 space-y-4">
          <div
            v-for="ticket in event.ticketTypes"
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
