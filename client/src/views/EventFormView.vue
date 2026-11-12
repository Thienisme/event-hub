<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue';
import DateTimePicker from '@/components/DateTimePicker.vue';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { EVENT_CATEGORIES, type EventCategory } from '@/utils/categories';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useEventStore } from '../stores/event';
import apiClient from '../api/axios';
import AppAlert from '../components/AppAlert.vue';
import BannerUploader from '../components/BannerUploader.vue';
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
const minimumStartTime = computed(() => isEditMode.value ? undefined : toAppDateTimeInput(new Date().toISOString()));

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
  /**
   * Biên trên của `orders.totalAmount` (DECIMAL(12,2)).
   *
   * Giá và số lượng được kiểm tra riêng, nhưng tích của chúng thì phải vừa
   * biên này — nếu không thì tạo sự kiện được nhưng mọi đơn đặt vé đều lỗi.
   */
  MAX_ORDER_AMOUNT: 9_999_999_999.99,
} as const;

const category = ref<EventCategory>('OTHER');
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
/** BannerUploader đang tải ảnh lên -> khoá nút submit để không lưu banner dở dang. */
const isUploadingBanner = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

/** Số ký tự mô tả còn lại — để người dùng thấy được giới hạn trước khi gõ quá. */
const descriptionRemaining = computed(() => LIMITS.DESCRIPTION - description.value.length);

/** Timer chuyển hướng sang trang chi tiết sau khi tạo sự kiện (xem handleSubmit). */
let redirectTimer: ReturnType<typeof setTimeout> | undefined;

/** Xoá sạch form trước khi nạp sự kiện khác, tránh để lại dữ liệu cũ. */
const resetForm = () => {
  category.value = 'OTHER';
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
      category.value = event.category || 'OTHER';
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
  if (!category.value || !title.value || !location.value || !startTime.value || !endTime.value) {
    errorMessage.value = 'Vui lòng nhập đầy đủ các trường bắt buộc!';
    return;
  }

  // Thời gian kết thúc phải SAU thời gian bắt đầu. Server đã chặn (400), nhưng
  // báo lỗi ngay ở form thì nhanh hơn là gửi đi rồi mới nhận lỗi từ server.
  if (new Date(endTime.value).getTime() <= new Date(startTime.value).getTime()) {
    errorMessage.value = 'Thời gian kết thúc phải sau thời gian bắt đầu!';
    return;
  }

  // Tổng tiền của một đơn = giá × số lượng, phải vừa biên DECIMAL(12,2) của
  // `orders.totalAmount`. Kiểm tra ngay ở form để người dùng biết trước khi
  // gửi, thay vì để tầng DB từ chối lúc đặt vé.
  const oversizedTicket = ticketTypes.value.find(
    t =>
      Math.round(Number(t.price) * Number(t.totalQuantity) * 100) / 100 >
      LIMITS.MAX_ORDER_AMOUNT
  );

  if (oversizedTicket) {
    errorMessage.value = `Tổng tiền của loại vé "${oversizedTicket.name}" vượt quá giới hạn ${LIMITS.MAX_ORDER_AMOUNT.toLocaleString('vi-VN')} của một đơn hàng!`;
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  const payload = {
    category: category.value,
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
  <div class="min-h-screen bg-surface pb-16">
    <div class="mx-auto max-w-4xl px-4 py-8">
      <div class="mb-4 flex justify-end">
        <Button variant="ghost" @click="router.push({ name: 'Home' })">Quay lại</Button>
      </div>
      <AppAlert :message="errorMessage" type="error" class="mb-4" />
      <AppAlert :message="successMessage" type="success" class="mb-4" />
      <Card>
        <CardHeader>
          <CardTitle class="text-2xl">{{ isEditMode ? 'Chỉnh sửa sự kiện' : 'Tạo sự kiện mới' }}</CardTitle>
          <CardDescription>Điền thông tin, thời gian tổ chức và các loại vé cho sự kiện của bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <form @submit.prevent="handleSubmit" class="space-y-6">
            <section class="space-y-4" aria-labelledby="general-heading">
              <h2 id="general-heading" class="text-sm font-semibold">Thông tin chung</h2>
              <div class="space-y-2">
                <Label for="event-title">Tiêu đề *</Label>
                <Input id="event-title" v-model="title" required :maxlength="LIMITS.TITLE" placeholder="Nhập tiêu đề sự kiện" />
              </div>
              <div class="space-y-2">
                <Label for="event-category">Danh mục *</Label>
                <Select v-model="category" required>
                  <SelectTrigger id="event-category" class="w-full"><SelectValue placeholder="Chọn danh mục" /></SelectTrigger>
                  <SelectContent><SelectItem v-for="item in EVENT_CATEGORIES" :key="item.value" :value="item.value">{{ item.label }}</SelectItem></SelectContent>
                </Select>
              </div>
              <div class="space-y-2">
                <Label for="event-description">Mô tả</Label>
                <Textarea id="event-description" v-model="description" :rows="4" :maxlength="LIMITS.DESCRIPTION" placeholder="Nhập mô tả chi tiết về sự kiện..." />
                <!-- Bộ đếm ký tự: chỉ hiện khi sắp chạm giới hạn, tránh rối mắt. -->
                <p v-if="descriptionRemaining < 500" class="text-right text-xs" :class="descriptionRemaining < 100 ? 'text-destructive font-medium' : 'text-muted-foreground'">Còn {{ descriptionRemaining }} ký tự</p>
              </div>
              <div class="space-y-2">
                <Label for="event-location">Địa điểm *</Label>
                <Input id="event-location" v-model="location" required :maxlength="LIMITS.LOCATION" placeholder="Nhập địa điểm tổ chức" />
              </div>
            </section>
            <Separator />
            <section class="space-y-4" aria-labelledby="banner-heading">
              <h2 id="banner-heading" class="text-sm font-semibold">Ảnh banner</h2>
              <!-- bannerUrl giữ kiểu string; quy đổi chuỗi rỗng sang null cho BannerUploader. -->
              <BannerUploader :model-value="bannerUrl || null" @update:model-value="v => (bannerUrl = v ?? '')" @uploading="v => (isUploadingBanner = v)" />
            </section>
            <Separator />
            <section class="space-y-4" aria-labelledby="time-heading">
              <h2 id="time-heading" class="text-sm font-semibold">Thời gian</h2>
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label for="event-start">Thời gian bắt đầu *</Label>
                  <DateTimePicker id="event-start" v-model="startTime" :min-date="minimumStartTime" placeholder="Chọn thời gian bắt đầu" />
                </div>
                <div class="space-y-2">
                  <Label for="event-end">Thời gian kết thúc *</Label>
                  <DateTimePicker id="event-end" v-model="endTime" :min-date="startTime || undefined" placeholder="Chọn thời gian kết thúc" />
                </div>
              </div>
            </section>
            <Separator />
            <section class="space-y-4" aria-labelledby="tickets-heading">
              <h2 id="tickets-heading" class="text-sm font-semibold">Loại vé</h2>
              <div v-if="ticketTypes.length === 0" class="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">Chưa có loại vé nào</div>
              <div v-for="(ticket, index) in ticketTypes" :key="index" class="grid grid-cols-1 items-end gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div class="space-y-2">
                  <Label :for="`ticket-name-${index}`">Tên loại vé</Label>
                  <Input :id="`ticket-name-${index}`" v-model="ticket.name" :maxlength="LIMITS.TICKET_NAME" placeholder="VD: Vé VIP, vé thường" />
                </div>
                <div class="space-y-2">
                  <Label :for="`ticket-price-${index}`">Giá (VNĐ)</Label>
                  <Input :id="`ticket-price-${index}`" v-model.number="ticket.price" type="number" min="0" step="0.01" :max="LIMITS.PRICE" />
                </div>
                <div class="space-y-2">
                  <Label :for="`ticket-quantity-${index}`">Số lượng</Label>
                  <Input :id="`ticket-quantity-${index}`" v-model.number="ticket.totalQuantity" type="number" min="1" :max="LIMITS.QUANTITY" />
                </div>
                <Button type="button" variant="ghost" size="icon" class="text-destructive" aria-label="Xoá loại vé" @click="removeTicketType(index)"><Trash2 aria-hidden="true" /></Button>
              </div>
              <Button type="button" variant="outline" @click="addTicketType"><Plus aria-hidden="true" />Thêm loại vé</Button>
            </section>
            <Separator />
            <Button type="submit" size="lg" class="w-full" :disabled="isLoading || isLoadingEvent || isUploadingBanner">
              <span v-if="isUploadingBanner">Đang tải ảnh banner...</span>
              <span v-else-if="isLoading">{{ isEditMode ? 'Đang cập nhật...' : 'Đang tạo...' }}</span>
              <span v-else-if="isLoadingEvent">Đang tải dữ liệu sự kiện...</span>
              <span v-else>{{ isEditMode ? 'Cập nhật sự kiện' : 'Tạo sự kiện' }}</span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
