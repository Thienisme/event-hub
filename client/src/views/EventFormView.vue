<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useEventStore } from '../stores/event';
import apiClient from '../api/axios';
import AppAlert from '../components/AppAlert.vue';
import { toAppDateTimeInput, fromAppDateTimeInput } from '../utils/format';
import type { EventItem, TicketType } from '../stores/event';

interface TicketTypeForm {
  /** Có id = loại vé đã tồn tại (BE update tại chỗ). Không id = loại vé mới. */
  id?: string;
  name: string;
  price: number | string;
  totalQuantity: number;
}

interface ApiResponse {
  message: string;
  event?: EventItem;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const eventStore = useEventStore();

/**
 * id phải là COMPUTED, không phải giá trị capture một lần.
 *
 * Trước đây `const eventId = route.params.id` chỉ đọc param đúng một lần lúc
 * component được setup. Vue-router tái sử dụng component khi chỉ khác param,
 * nên điều hướng /events/1/edit -> /events/2/edit sẽ vẫn tải và CẬP NHẬT
 * sự kiện 1 trong khi user đang nhìn sự kiện 2.
 */
const eventId = computed(() => (route.params.id as string | undefined) || undefined);
const isEditMode = computed(() => !!eventId.value);

/**
 * Giới hạn nhập liệu — PHẢI khớp với cột DB và với LIMITS ở
 * server/src/utils/validation.ts.
 *
 * Mục đích: chặn lỗi NGAY LÚC GÕ, thay vì để dữ liệu vượt giới hạn bay tới
 * MySQL rồi mới nhận về 500 "Lỗi máy chủ" không rõ nguyên nhân.
 */
const LIMITS = {
  TITLE: 255,
  DESCRIPTION: 5000,
  LOCATION: 255,
  BANNER_URL: 500,
  TICKET_NAME: 100,
  PRICE: 9_999_999_999.99,
  QUANTITY: 2_147_483_647,
} as const;

const title = ref('');
const description = ref('');
const location = ref('');
const bannerUrl = ref('');
const startTime = ref('');
const endTime = ref('');
const ticketTypes = ref<TicketTypeForm[]>([]);
const isLoading = ref(false);
/** Đang nạp dữ liệu sự kiện để sửa -> chặn submit để không lưu nhầm form rỗng. */
const isLoadingEvent = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

/** Số ký tự mô tả còn lại — để người dùng thấy được giới hạn trước khi gõ quá. */
const descriptionRemaining = computed(() => LIMITS.DESCRIPTION - description.value.length);

/** Timer chuyển hướng sang trang chi tiết sau khi tạo sự kiện (xem handleSubmit). */
let redirectTimer: ReturnType<typeof setTimeout> | undefined;

/** Xoá sạch form trước khi nạp sự kiện khác, tránh để lại dữ liệu cũ. */
const resetForm = () => {
  title.value = '';
  description.value = '';
  location.value = '';
  bannerUrl.value = '';
  startTime.value = '';
  endTime.value = '';
  ticketTypes.value = [];
  errorMessage.value = '';
  successMessage.value = '';
};

const loadEventForEdit = async (id: string) => {
  isLoadingEvent.value = true;
  try {
    const event = await eventStore.fetchEventById(id);
    if (event) {
      title.value = event.title;
      description.value = event.description || '';
      location.value = event.location;
      bannerUrl.value = event.bannerUrl || '';
      // Chuyển từ UTC (BE) sang giờ nghiệp vụ cho ô datetime-local.
      // Cắt chuỗi ISO thẳng sẽ đưa nhầm giờ UTC vào ô nhập -> lệch múi giờ.
      startTime.value = toAppDateTimeInput(event.startTime);
      endTime.value = toAppDateTimeInput(event.endTime);
      // Phải giữ `id`: BE dựa vào id để update tại chỗ và giữ nguyên số vé đã bán.
      // Bỏ id đi thì mỗi lần lưu sẽ tạo loại vé mới và xoá loại chưa bán.
      ticketTypes.value = event.ticketTypes?.map((t: TicketType) => ({
        id: t.id,
        name: t.name,
        price: t.price,
        totalQuantity: t.totalQuantity,
      })) || [];
    } else {
      errorMessage.value = 'Không tìm thấy sự kiện này!';
    }
  } catch (error: any) {
    errorMessage.value = error.response?.data?.message || 'Không tải được thông tin sự kiện!';
  } finally {
    isLoadingEvent.value = false;
  }
};

onMounted(() => {
  if (!authStore.isAuthenticated) {
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }

  if (!authStore.isOrganizer) {
    router.push({ name: 'Home' });
    return;
  }

  if (eventId.value) {
    loadEventForEdit(eventId.value);
  }
});

// Chuyển /events/1/edit -> /events/2/edit: component được tái sử dụng, phải nạp
// lại dữ liệu sự kiện mới, nếu không form sẽ hiển thị (và lưu) sự kiện cũ.
watch(eventId, (newId, oldId) => {
  if (newId === oldId) return;

  if (!authStore.isAuthenticated) {
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }

  if (!authStore.isOrganizer) {
    router.push({ name: 'Home' });
    return;
  }

  resetForm();

  if (newId) {
    loadEventForEdit(newId);
  }
});

const addTicketType = () => {
  ticketTypes.value.push({
    name: '',
    price: 0,
    totalQuantity: 0,
  });
};

const removeTicketType = (index: number) => {
  ticketTypes.value.splice(index, 1);
};

const handleSubmit = async () => {
  if (!title.value || !location.value || !startTime.value || !endTime.value) {
    errorMessage.value = 'Vui lòng nhập đầy đủ các trường bắt buộc!';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  const payload = {
    title: title.value,
    description: description.value || null,
    location: location.value,
    bannerUrl: bannerUrl.value || null,
    // Ô datetime-local trả về giờ nghiệp vụ -> quy đổi sang UTC để BE lưu đúng.
    startTime: fromAppDateTimeInput(startTime.value),
    endTime: fromAppDateTimeInput(endTime.value),
    // Luôn gửi mảng (kể cả rỗng) ở chế độ edit: mảng rỗng = người dùng xoá hết loại vé.
    // Ở chế độ create, mảng rỗng cũng vô hại vì createEvent chỉ tạo khi length > 0.
    ticketTypes: ticketTypes.value.map(t => ({
      id: t.id,
      name: t.name,
      price: Number(t.price),
      totalQuantity: Number(t.totalQuantity),
    })),
  };

  try {
    // Dùng apiClient thay vì fetch trần: tự gắn Bearer token, tự xử lý 401,
    // message lỗi nằm ở error.response.data.message.
    if (isEditMode.value) {
      const { data } = await apiClient.put<ApiResponse>(`/events/${eventId.value}`, payload);
      successMessage.value = data.message;
    } else {
      const { data } = await apiClient.post<ApiResponse>('/events', payload);
      successMessage.value = data.message;
      // Chuyển hướng đến trang chi tiết sự kiện vừa tạo
      if (data.event) {
        redirectTimer = setTimeout(() => {
          redirectTimer = undefined;
          router.push({ name: 'EventDetail', params: { id: data.event!.id } });
        }, 1500);
      }
    }
  } catch (error: any) {
    errorMessage.value =
      error.response?.data?.message || 'Thao tác thất bại, vui lòng thử lại!';
  } finally {
    isLoading.value = false;
  }
};

// Rời trang trước khi hết 1.5s thì huỷ chuyển hướng, tránh bị kéo lại sau khi
// user đã chuyển sang trang khác.
onUnmounted(() => {
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = undefined;
  }
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 pb-16">
    <div class="max-w-3xl mx-auto px-4 py-8">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold text-gray-900">
          {{ isEditMode ? 'Chỉnh sửa sự kiện' : 'Tạo sự kiện mới' }}
        </h1>
        <button
          @click="router.push({ name: 'Home' })"
          class="px-4 py-2 text-sm text-gray-600 hover:text-indigo-600 transition-colors"
        >
          Quay lại
        </button>
      </div>

      <AppAlert :message="errorMessage" type="error" class="mb-4" />
      <AppAlert :message="successMessage" type="success" class="mb-4" />

      <form @submit.prevent="handleSubmit" class="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Tiêu đề *</label>
          <input
            v-model="title"
            type="text"
            required
            :maxlength="LIMITS.TITLE"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="Nhập tiêu đề sự kiện"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
          <textarea
            v-model="description"
            rows="4"
            :maxlength="LIMITS.DESCRIPTION"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="Nhập mô tả chi tiết về sự kiện..."
          ></textarea>
          <!-- Bộ đếm ký tự: chỉ hiện khi sắp chạm giới hạn, tránh rối mắt. -->
          <p
            v-if="descriptionRemaining < 500"
            class="text-xs text-right mt-1"
            :class="descriptionRemaining < 100 ? 'text-red-600 font-medium' : 'text-gray-400'"
          >
            Còn {{ descriptionRemaining }} ký tự
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Địa điểm *</label>
          <input
            v-model="location"
            type="text"
            required
            :maxlength="LIMITS.LOCATION"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="Nhập địa điểm tổ tổ chức"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">URL Banner</label>
          <input
            v-model="bannerUrl"
            type="url"
            :maxlength="LIMITS.BANNER_URL"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            placeholder="https://example.com/banner.jpg"
          />
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Thời gian bắt đầu *</label>
            <input
              v-model="startTime"
              type="datetime-local"
              required
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Thời gian kết thúc *</label>
            <input
              v-model="endTime"
              type="datetime-local"
              required
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Loại vé</label>
          <div v-if="ticketTypes.length === 0" class="text-center py-6 border border-dashed border-gray-200 rounded-lg">
            <p class="text-gray-500 text-sm">Chưa có loại vé nào</p>
            <button
              type="button"
              @click="addTicketType"
              class="mt-2 px-4 py-2 text-sm text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              + Thêm loại vé
            </button>
          </div>

          <div v-else class="space-y-4">
            <div
              v-for="(ticket, index) in ticketTypes"
              :key="index"
              class="border border-gray-200 rounded-lg p-4 space-y-3"
            >
              <div class="flex items-center justify-between">
                <h3 class="font-medium text-gray-900">Loại vé #{{ index + 1 }}</h3>
                <button
                  type="button"
                  @click="removeTicketType(index)"
                  class="px-2 py-1 text-sm text-red-600 hover:text-red-800 transition-colors"
                >
                  Xóa
                </button>
              </div>

              <div>
                <label class="block text-sm text-gray-600 mb-1">Tên loại vé</label>
                <input
                  v-model="ticket.name"
                  type="text"
                  :maxlength="LIMITS.TICKET_NAME"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="VD: VIP, Standard"
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm text-gray-600 mb-1">Giá (VNĐ)</label>
                  <input
                    v-model.number="ticket.price"
                    type="number"
                    min="0"
                    step="0.01"
                    :max="LIMITS.PRICE"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
                <div>
                  <label class="block text-sm text-gray-600 mb-1">Số lượng</label>
                  <input
                    v-model.number="ticket.totalQuantity"
                    type="number"
                    min="1"
                    :max="LIMITS.QUANTITY"
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              @click="addTicketType"
              class="px-4 py-2 text-sm text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              + Thêm loại vé
            </button>
          </div>
        </div>

        <div class="pt-4 border-t">
          <button
            type="submit"
            :disabled="isLoading || isLoadingEvent"
            class="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <span v-if="isLoading">{{ isEditMode ? 'Đang cập nhật...' : 'Đang tạo...' }}</span>
            <span v-else-if="isLoadingEvent">Đang tải dữ liệu sự kiện...</span>
            <span v-else>{{ isEditMode ? 'Cập nhật sự kiện' : 'Tạo sự kiện' }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
