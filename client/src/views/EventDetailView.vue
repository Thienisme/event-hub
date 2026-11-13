<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import type { EventItem, TicketType } from '../stores/event';
import { usePromoStore } from '@/stores/promo';
import { bestOfferText, type Offer } from '@/utils/offers';
import { useOrderStore } from '../stores/order';
import { useAuthStore } from '../stores/auth';
import { useWaitlistStore } from '../stores/waitlist';
import { useToastStore } from '../stores/toast';
import apiClient from '../api/axios';
import { formatPrice, formatDateTime, getEventPhase, toAppDateTimeInput } from '../utils/format';
import { categoryLabel } from '@/utils/categories';
import AppAlert from '../components/AppAlert.vue';
import EventActions from '../components/EventActions.vue';
import EventBanner from '../components/EventBanner.vue';
import { ArrowLeft, CalendarDays, MapPin, UserRound, Clock, Minus, Plus, Pencil, Trash2, Ticket, TicketPercent, CircleAlert, Bell } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const route = useRoute();
const router = useRouter();
const eventStore = useEventStore();
const orderStore = useOrderStore();
const promoStore = usePromoStore();
const offers = ref<Offer[]>([]);
const authStore = useAuthStore();
const waitlistStore = useWaitlistStore();
const toast = useToastStore();

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
const now = ref(Date.now());
const saleTimer = setInterval(() => { now.value = Date.now(); }, 1000);
const saleLabel = (ticket: TicketType) => {
  if (ticket.saleStart && new Date(ticket.saleStart).getTime() > now.value) return `Mở bán lúc ${formatDateTime(ticket.saleStart)}`;
  if (ticket.saleEnd && new Date(ticket.saleEnd).getTime() <= now.value) return 'Đã ngừng bán';
  return '';
};

/** Sự kiện đã kết thúc thì không bán vé nữa (server cũng chặn, xem createOrder). */
const isEnded = computed(
  () => !!event.value && new Date(event.value.endTime).getTime() <= now.value
);

const eventPhase = computed(() => event.value ? getEventPhase(event.value.startTime, event.value.endTime) : 'upcoming');
const phaseLabel = computed(() => ({ upcoming: 'Sắp diễn ra', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc' })[eventPhase.value]);
const organizerInitials = computed(() => event.value?.organizer?.fullName?.trim().split(/\s+/).slice(-2).map((word) => word[0]).join('').toLocaleUpperCase('vi-VN') || 'BTC');

const ticketSection = ref<HTMLElement | null>(null);
const ticketSectionVisible = ref(true);
let ticketObserver: IntersectionObserver | undefined;
watch(ticketSection, (element) => {
  ticketObserver?.disconnect();
  ticketSectionVisible.value = true;
  if (!element) return;
  ticketObserver = new IntersectionObserver(([entry]) => { ticketSectionVisible.value = entry?.isIntersecting ?? false; });
  ticketObserver.observe(element);
}, { flush: 'post' });
const saleableTickets = computed(() => (event.value?.ticketTypes ?? []).filter(ticket => ticket.availableQuantity > 0 && !saleLabel(ticket)));
const lowestPrice = computed(() => Math.min(...saleableTickets.value.map(ticket => Number(ticket.price))));
const scrollToTickets = () => ticketSection.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
const eventDates = computed(() => {
  const start = toAppDateTimeInput(event.value?.startTime);
  const end = toAppDateTimeInput(event.value?.endTime);
  const dateLabel = (value: string) => {
    const date = value.slice(0, 10);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return `${weekday === 0 ? 'Chủ nhật' : `Thứ ${weekday + 1}`}, ${date.split('-').reverse().join('/')}`;
  };
  return {
    banner: start.slice(0, 10).split('-').reverse().join(' · '),
    lines: start.slice(0, 10) === end.slice(0, 10)
      ? [dateLabel(start), `${start.slice(11)} – ${end.slice(11)}`]
      : [`Từ ${start.slice(11)} ${dateLabel(start)}`, `Đến ${end.slice(11)} ${dateLabel(end)}`],
  };
});
const soldQuantity = (ticket: TicketType) => Math.max(0, ticket.totalQuantity - ticket.availableQuantity);
const soldPercent = (ticket: TicketType) => ticket.totalQuantity > 0 ? Math.min(100, soldQuantity(ticket) / ticket.totalQuantity * 100) : 0;

/** Số lượng vé user chọn cho từng loại vé, key = ticketTypeId */
const quantities = ref<Record<string, number>>({});
const ticketSubtotal = (ticket: TicketType) => {
  const quantity = Number(quantities.value[ticket.id]);
  return Number.isInteger(quantity) && quantity > 0 ? formatPrice(Number(ticket.price) * quantity) : '—';
};

/**
 * Danh sách chờ: loại vé hết vé nhưng sự kiện chưa kết thúc và còn trong
 * giờ bán -> cho user đăng ký nhận báo khi có vé trả về.
 */
const canJoinWaitlist = (ticket: TicketType): boolean =>
  ticket.availableQuantity <= 0 && !isEnded.value && !saleLabel(ticket) && !!event.value;

const isWaitingTicket = (ticket: TicketType): boolean =>
  !!event.value && waitlistStore.isWaiting(event.value.id, ticket.id);

const waitlistBusyId = ref<string | null>(null);

const handleWaitlist = async (ticket: TicketType) => {
  const eventId = event.value?.id;
  if (!eventId || waitlistBusyId.value) return;

  // POST/DELETE waitlist cần Bearer token -> chưa đăng nhập thì sang trang login
  if (!authStore.isAuthenticated) {
    router.push({ name: 'Login', query: { redirect: route.fullPath } });
    return;
  }

  const wasWaiting = isWaitingTicket(ticket);
  waitlistBusyId.value = ticket.id;

  try {
    const response = wasWaiting
      ? await waitlistStore.leave(eventId, ticket.id)
      : await waitlistStore.join(eventId, ticket.id);
    toast.success(response.message || (wasWaiting ? 'Đã rời danh sách chờ vé.' : 'Sẽ báo cho bạn khi có vé!'));
  } catch (error: any) {
    const status = error?.response?.status;

    if (status === 401 || status === 403) {
      authStore.logout();
      waitlistStore.reset();
      router.push({ name: 'Login', query: { redirect: route.fullPath } });
      return;
    }

    toast.error(error?.response?.data?.message || 'Không đăng ký được danh sách chờ, vui lòng thử lại!');
  } finally {
    waitlistBusyId.value = null;
  }
};

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
  offers.value = [];
  quantities.value = {};
  isLoading.value = true;

  try {
    const loaded = await eventStore.fetchEventById(id, controller.signal);

    if (!loaded) {
      loadError.value = 'Không tìm thấy sự kiện này!';
      return;
    }

    if (controller.signal.aborted) return;
    event.value = loaded;
    void promoStore.fetchEventOffers(loaded.id, controller.signal).then(data => {
      if (!controller.signal.aborted) offers.value = data;
    }).catch(() => {});

    // Mặc định mỗi loại vé chọn 1
    quantities.value = Object.fromEntries(
      (loaded.ticketTypes ?? []).map((ticket) => [ticket.id, 1])
    );

    // Trạng thái danh sách chờ là của từng user: tải nền, lỗi không chặn trang.
    if (authStore.isAuthenticated) {
      waitlistStore.load(loaded.id).catch(() => undefined);
    }
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
  clearInterval(saleTimer);
  ticketObserver?.disconnect();
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
  if (submittingId.value) return;
  errorMessage.value = '';
  if (saleLabel(ticket) || isEnded.value) return;

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
    const { order } = await orderStore.createOrder(ticket.id, quantity);
    toast.success('Đã giữ chỗ. Hãy thanh toán trước khi đơn hết hạn.');
    router.push({ name: 'Checkout', params: { orderId: order.id } });
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
  const id = event.value?.id;
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
  <div class="min-h-screen bg-surface pb-24 lg:pb-0 text-foreground">
    <div v-if="isLoading" class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6" role="status" aria-label="Đang tải thông tin sự kiện">
      <span class="sr-only">Đang tải thông tin sự kiện...</span>
      <Skeleton class="h-5 w-44" />
      <Skeleton class="aspect-video w-full rounded-lg lg:aspect-[21/9]" />
      <div class="grid gap-8 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          <Skeleton class="h-10 w-3/4" />
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2"><Skeleton v-for="item in 4" :key="item" class="h-28 rounded-lg" /></div>
          <Skeleton class="h-40 rounded-lg" />
        </div>
        <Skeleton class="h-96 rounded-lg" />
      </div>
    </div>

    <div v-else-if="loadError" class="mx-auto max-w-xl px-4 py-20">
      <Card class="shadow-none ring-0 border border-border bg-background rounded-lg text-center">
        <CardContent class="space-y-5 p-8">
          <CircleAlert class="mx-auto size-12 text-muted-foreground" />
          <h1 class="text-xl font-semibold tracking-tight" role="alert">{{ loadError }}</h1>
          <p class="text-sm leading-6 text-muted-foreground">Bạn có thể thử tải lại hoặc khám phá các sự kiện khác.</p>
          <div class="flex flex-wrap justify-center gap-2">
            <Button variant="outline" @click="router.push({ name: 'Home' })"><ArrowLeft />Về trang chủ</Button>
            <Button @click="loadEvent(String(route.params.id))">Thử lại</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <div v-else-if="event" class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="link" class="mb-5 h-auto px-0 text-muted-foreground hover:text-primary" @click="router.push({ name: 'Home' })">
        <ArrowLeft />Quay lại danh sách
      </Button>
      <EventBanner :src="event.bannerUrl" :alt="event.title" class="rounded-lg [&>img]:aspect-video lg:[&>img]:aspect-[21/9]">
        <template #placeholder>
          <div class="flex aspect-[3/1] items-end rounded-lg bg-primary p-6 text-primary-foreground sm:aspect-[4/1] sm:p-10">
            <div class="space-y-2"><p class="text-xs font-semibold uppercase tracking-widest text-primary-foreground/70">{{ categoryLabel(event.category ?? 'OTHER') }}</p><p class="text-2xl font-extrabold tabular-nums sm:text-4xl">{{ eventDates.banner }}</p></div>
          </div>
        </template>
      </EventBanner>

      <div class="mt-8 flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div class="min-w-0 space-y-3">
          <Badge :variant="eventPhase === 'ended' ? 'muted' : eventPhase === 'ongoing' ? 'success' : 'info'">{{ phaseLabel }}</Badge>
          <h1 class="break-words text-3xl sm:text-4xl font-extrabold tracking-tight">{{ event.title }}</h1>
        </div>
        <div v-if="authStore.isOrganizer" class="flex shrink-0 flex-wrap gap-2">
          <Button as-child variant="outline" class="rounded-md"><router-link :to="{ name: 'EditEvent', params: { id: event.id } }"><Pencil />Chỉnh sửa sự kiện</router-link></Button>
          <Button variant="destructive" class="rounded-md" :disabled="isDeleting" @click="handleDelete"><Trash2 />{{ isDeleting ? 'Đang xóa...' : 'Xóa sự kiện' }}</Button>
        </div>
      </div>
      <AppAlert v-if="deleteError" :message="deleteError" type="error" class="mt-4" />

      <div class="mt-8 grid min-w-0 items-start gap-8 lg:grid-cols-3">
        <div class="min-w-0 space-y-8 lg:col-span-2">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="flex min-w-0 gap-3 rounded-lg border bg-background p-5 sm:col-span-2">
              <CalendarDays class="mt-1 size-5 shrink-0 text-primary" />
              <div class="min-w-0"><p class="text-sm text-muted-foreground">Thời gian</p><p v-for="line in eventDates.lines" :key="line" class="mt-1 break-words font-medium tabular-nums">{{ line }}</p></div>
            </div>
            <div class="flex min-w-0 gap-3 rounded-lg border bg-background p-5">
              <MapPin class="mt-1 size-5 shrink-0 text-primary" />
              <div class="min-w-0"><p class="text-sm text-muted-foreground">Địa điểm</p><p class="mt-1 break-words font-medium">{{ event.location }}</p></div>
            </div>
            <div class="flex min-w-0 gap-3 rounded-lg border bg-background p-5">
              <UserRound class="mt-1 size-5 shrink-0 text-primary" />
              <div class="min-w-0"><p class="text-sm text-muted-foreground">Ban tổ chức</p><div class="mt-2 flex items-center gap-2"><Avatar><AvatarFallback class="bg-primary/10 text-xs text-primary">{{ organizerInitials }}</AvatarFallback></Avatar><p class="min-w-0 break-words font-medium">{{ event.organizer?.fullName || 'Chưa cập nhật' }}</p></div></div>
            </div>
          </div>
          <section class="rounded-lg border bg-background p-5 sm:p-6">
            <h2 class="text-xl font-semibold tracking-tight">Giới thiệu</h2>
            <p class="mt-4 whitespace-pre-line break-words leading-relaxed text-muted-foreground">{{ event.description?.trim() ? event.description : 'Ban tổ chức chưa thêm mô tả' }}</p>
          </section>
          <EventActions :event="event" class="mt-6" />
        </div>

        <aside id="ticket-selection" ref="ticketSection" class="min-w-0 scroll-mt-20 lg:sticky lg:top-20" aria-label="Đặt vé sự kiện">
          <Card class="shadow-none ring-0 border border-border bg-background gap-0 overflow-hidden rounded-lg py-0">
            <CardHeader class="border-b p-5 sm:p-6"><CardTitle class="flex items-center gap-2 text-xl font-semibold tracking-tight"><Ticket class="size-5 text-primary" />Chọn loại vé</CardTitle><p class="mt-2 text-sm leading-6 text-muted-foreground">Chọn số lượng, đặt vé rồi thanh toán để nhận mã QR.</p></CardHeader>
            <CardContent class="space-y-4 p-5 sm:p-6">
              <AppAlert :message="errorMessage" type="error" />
              <p v-if="isEnded" class="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Sự kiện đã kết thúc và không còn nhận đặt vé.</p>
              <p v-if="!event.ticketTypes?.length" class="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Sự kiện này chưa mở bán loại vé nào.</p>
              <p v-if="offers.length" class="rounded-md bg-brand-soft px-3 py-2 text-sm text-brand"><TicketPercent class="mr-1 inline size-4" aria-hidden="true" /><strong>Có ưu đãi</strong> · {{ bestOfferText(offers) }}<span class="text-muted-foreground"> · áp dụng ở bước thanh toán</span></p>
              <div v-for="ticket in event.ticketTypes" :key="ticket.id" class="min-w-0 space-y-4 rounded-lg border p-4 transition-colors" :class="{ 'bg-muted/50': ticket.availableQuantity <= 0, 'opacity-60': ticket.availableQuantity <= 0 && !canJoinWaitlist(ticket) }">
                <div class="space-y-1"><h3 class="break-words font-semibold">{{ ticket.name }}</h3><p class="break-words text-xl font-semibold tabular-nums text-brand">{{ formatPrice(ticket.price) }}</p>
                </div>
                <div>
                  <div class="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-muted-foreground">
                    <span>Đã bán {{ soldQuantity(ticket) }} / {{ ticket.totalQuantity }}</span>
                    <span :class="ticket.availableQuantity > 0 && ticket.availableQuantity <= ticket.totalQuantity * 0.1 ? 'text-brand font-medium' : ''">{{ ticket.availableQuantity <= 0 ? 'Hết vé' : ticket.availableQuantity <= ticket.totalQuantity * 0.1 ? `Chỉ còn ${ticket.availableQuantity} vé` : `Còn ${ticket.availableQuantity}` }}</span>
                  </div>
                  <div class="mt-2 h-1.5 overflow-hidden rounded-md bg-muted" role="progressbar" :aria-valuenow="soldQuantity(ticket)" :aria-valuemax="ticket.totalQuantity" :aria-valuemin="0" :aria-label="`Số vé đã bán loại ${ticket.name}`"><div class="h-full rounded-md" :class="ticket.availableQuantity <= ticket.totalQuantity * 0.1 ? 'bg-brand' : 'bg-foreground'" :style="{ width: `${soldPercent(ticket)}%` }" /></div>
                </div>
                <p v-if="saleLabel(ticket)" class="text-sm text-muted-foreground" aria-live="polite">{{ saleLabel(ticket) }}</p>
                <div v-if="!canJoinWaitlist(ticket)" class="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                  <span class="text-muted-foreground">Thành tiền</span>
                  <span class="font-semibold tabular-nums" aria-live="polite" aria-atomic="true">{{ ticketSubtotal(ticket) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-3" :aria-busy="submittingId === ticket.id">
                  <!-- Hết vé thì bộ chọn số lượng vô nghĩa: nhường chỗ cho nút danh sách chờ -->
                  <div v-if="!canJoinWaitlist(ticket)" class="flex items-center rounded-lg border bg-background">
                    <Button variant="ghost" size="icon" class="rounded-md" :aria-label="`Giảm số lượng vé ${ticket.name}`" :disabled="!!submittingId || isEnded || !!saleLabel(ticket) || ticket.availableQuantity <= 0 || quantities[ticket.id] <= 1" @click="quantities[ticket.id] = Number(quantities[ticket.id]) - 1; normalizeQuantity(ticket)"><Minus /></Button>
                    <input v-model.number="quantities[ticket.id]" type="number" min="1" :max="ticket.availableQuantity" :disabled="!!submittingId || isEnded || !!saleLabel(ticket) || ticket.availableQuantity <= 0" :aria-label="`Số lượng vé ${ticket.name}`" class="h-9 w-12 min-w-0 appearance-none bg-transparent text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" @blur="normalizeQuantity(ticket)" />
                    <Button variant="ghost" size="icon" class="rounded-md" :aria-label="`Tăng số lượng vé ${ticket.name}`" :disabled="!!submittingId || isEnded || !!saleLabel(ticket) || ticket.availableQuantity <= 0 || quantities[ticket.id] >= ticket.availableQuantity" @click="quantities[ticket.id] = Number(quantities[ticket.id]) + 1; normalizeQuantity(ticket)"><Plus /></Button>
                  </div>
                  <Button v-if="canJoinWaitlist(ticket)" variant="outline" class="min-w-24 flex-1 rounded-md" :disabled="waitlistBusyId === ticket.id" @click="handleWaitlist(ticket)">
                    <Bell />
                    <span v-if="waitlistBusyId === ticket.id">Đang xử lý...</span><span v-else-if="isWaitingTicket(ticket)">Đang chờ vé · Huỷ</span><span v-else>Báo tôi khi có vé</span>
                  </Button>
                  <Button v-else class="min-w-24 flex-1 rounded-md" :class="isEnded || !!saleLabel(ticket) || ticket.availableQuantity <= 0 ? '' : 'bg-brand text-brand-foreground hover:bg-brand/90'" :disabled="!!submittingId || isEnded || !!saleLabel(ticket) || ticket.availableQuantity <= 0" @click="handleBook(ticket)">
                    <span v-if="isEnded">Đã kết thúc</span><span v-else-if="saleLabel(ticket)">{{ ticket.saleStart && new Date(ticket.saleStart).getTime() > now ? 'Chưa mở bán' : 'Đã ngừng bán' }}</span><span v-else-if="submittingId === ticket.id">Đang xử lý...</span><span v-else-if="ticket.availableQuantity <= 0">Hết vé</span><span v-else>Đặt vé</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <p class="mt-4 flex items-start justify-center gap-2 px-2 text-center text-xs leading-relaxed text-muted-foreground"><Clock class="mt-0.5 size-4 shrink-0" />Vé được giữ chỗ 10 phút để thanh toán</p>
        </aside>
      </div>
    </div>
    <div v-if="event && !isLoading && !loadError && !isEnded && saleableTickets.length && !ticketSectionVisible" class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p class="text-sm text-muted-foreground">Từ <span class="text-brand font-semibold tabular-nums">{{ lowestPrice === 0 ? 'Miễn phí' : formatPrice(lowestPrice) }}</span></p>
        <Button class="bg-brand text-brand-foreground hover:bg-brand/90" aria-controls="ticket-selection" @click="scrollToTickets">Chọn vé</Button>
      </div>
    </div>
  </div>
</template>
