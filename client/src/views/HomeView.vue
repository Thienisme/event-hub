<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import { useAuthStore } from '../stores/auth';
import EventCard from '../components/EventCard.vue';
import { Search, CalendarSearch, CircleAlert, Plus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const router = useRouter();
const eventStore = useEventStore();
const authStore = useAuthStore();

const searchQuery = ref('');
const currentPage = ref(1);
const status = ref<'upcoming' | 'ended'>('upcoming');
const limit = ref(8);
const totalPages = ref(1);
const errorMessage = ref('');

// Phân biệt "chưa gọi API lần nào" với "đã gọi xong và không có dữ liệu".
// Thiếu cờ này, lần render đầu tiên (chạy TRƯỚC onMounted) thấy events = []
// nên sẽ nháy lên thông báo "Không tìm thấy sự kiện nào" trong tích tắc.
const loaded = ref(false);

// Giữ controller của request đang bay để huỷ khi có request mới (search/đổi trang).
let inFlight: AbortController | undefined;

// Hàm load danh sách sự kiện từ API
const loadEvents = async () => {
  // Huỷ request cũ: nếu user gõ nhanh "a" rồi "ab", response của "a" có thể về SAU
  // và ghi đè kết quả của "ab" (race condition). Huỷ đi là hết.
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  errorMessage.value = '';

  try {
    const res = await eventStore.fetchEvents(
      {
        page: currentPage.value,
        limit: limit.value,
        search: searchQuery.value,
        status: status.value,
      },
      controller.signal
    );

    if (res?.pagination) {
      totalPages.value = res.pagination.totalPages;
    }
  } catch (error: any) {
    // Request bị chính mình huỷ -> không phải lỗi, đừng hiện thông báo.
    if (error?.code === 'ERR_CANCELED') return;
    // Trước đây lỗi mạng không được bắt: BE chết thì UI hiện "Không tìm thấy 
    // sự kiện nào", khiến user tưởng hết dữ liệu thay vì biết là mất kết nối.
    errorMessage.value =
      error.response?.data?.message || 'Không tải được danh sách sự kiện!';
  } finally {
    loaded.value = true;
  }
};

// Xử lý tìm kiếm có Debounce (đợi người dùng gõ xong 400ms mới gọi API)
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const handleSearchInput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage.value = 1; // Reset về trang 1 khi tìm kiếm
    loadEvents();
  }, 400);
};

// Đổi tab giữ từ khoá tìm kiếm và tải lại từ trang đầu.
const changeStatus = (value: string | number) => {
  const nextStatus = value === 'ended' ? 'ended' : 'upcoming';
  if (nextStatus === status.value) return;
  clearTimeout(searchTimer);
  status.value = nextStatus;
  currentPage.value = 1;
  loadEvents();
};

// Chuyển trang
const changePage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
  loadEvents();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

onMounted(() => {
  loadEvents();
});

// Dọn dẹp khi rời trang: nếu không, timer debounce còn treo sẽ gọi API
// sau khi component đã bị huỷ (request "mồ côi").
onUnmounted(() => {
  clearTimeout(searchTimer);
  inFlight?.abort();
});
</script>

<template>
  <div class="min-h-screen bg-surface px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
    <div class="mx-auto max-w-7xl space-y-8">
      <section class="relative isolate overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-violet-500/10 px-5 py-10 sm:px-10 sm:py-14">
        <div aria-hidden="true" class="pointer-events-none absolute -right-16 -top-20 -z-10 size-72 rounded-full bg-primary/10 blur-3xl"></div>
        <div class="flex flex-col items-start justify-between gap-6 lg:flex-row">
          <div class="w-full min-w-0 max-w-2xl">
            <p class="mb-3 text-sm font-semibold text-primary">Trải nghiệm mới đang chờ bạn</p>
            <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">Khám phá sự kiện hấp dẫn</h1>
            <p class="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">Tìm cảm hứng, kết nối cộng đồng và đặt vé cho những khoảnh khắc đáng nhớ.</p>
            <div class="relative mt-7">
              <Search class="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input v-model="searchQuery" @input="handleSearchInput" type="search" aria-label="Tìm kiếm sự kiện" placeholder="Tìm tên sự kiện, địa điểm…" class="h-14 rounded-xl bg-card pl-12 pr-4 text-base shadow-sm" />
            </div>
          </div>
          <Button v-if="authStore.isOrganizer" @click="router.push({ name: 'CreateEvent' })" class="shrink-0 rounded-xl"><Plus aria-hidden="true" />Tạo sự kiện</Button>
        </div>
      </section>

      <section aria-label="Danh sách sự kiện" :aria-busy="eventStore.loading || !loaded">
        <h2 class="mb-5 text-xl font-semibold tracking-tight">{{ searchQuery ? 'Kết quả tìm kiếm' : 'Sự kiện dành cho bạn' }}</h2>
        <Tabs :model-value="status" @update:model-value="changeStatus" class="mb-5">
          <TabsList aria-label="Trạng thái sự kiện">
            <TabsTrigger value="upcoming">Sắp diễn ra</TabsTrigger>
            <TabsTrigger value="ended">Đã kết thúc</TabsTrigger>
          </TabsList>
        </Tabs>
        <div v-if="eventStore.loading || !loaded" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Đang tải sự kiện">
          <Card v-for="n in 8" :key="n" aria-hidden="true" class="gap-0 rounded-2xl border py-0 shadow-sm ring-0">
            <Skeleton class="aspect-video w-full rounded-none" />
            <div class="space-y-3 p-4">
              <Skeleton class="h-5 w-full" /><Skeleton class="h-5 w-2/3" />
              <Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-3/4" />
              <div class="flex items-center justify-between border-t pt-4"><Skeleton class="h-8 w-24" /><Skeleton class="h-8 w-16" /></div>
            </div>
          </Card>
        </div>
        <Card v-else-if="errorMessage" role="alert" class="items-center rounded-2xl border px-5 py-14 text-center shadow-sm ring-0">
          <CircleAlert class="size-12 text-danger" aria-hidden="true" />
          <div><h3 class="text-lg font-semibold tracking-tight">Không tải được dữ liệu</h3><p class="mt-2 break-words text-sm text-muted-foreground">{{ errorMessage }}</p></div>
          <Button @click="loadEvents">Thử lại</Button>
        </Card>
        <Card v-else-if="eventStore.events.length === 0" class="items-center rounded-2xl border px-5 py-14 text-center shadow-sm ring-0">
          <div class="rounded-2xl bg-primary/10 p-4"><CalendarSearch class="size-10 text-primary" aria-hidden="true" /></div>
          <div><h3 class="text-lg font-semibold tracking-tight">{{ status === 'ended' ? 'Chưa có sự kiện nào đã kết thúc' : 'Không tìm thấy sự kiện phù hợp' }}</h3><p class="mt-2 text-sm text-muted-foreground">Thử từ khóa khác hoặc quay lại sau để khám phá sự kiện mới.</p></div>
          <Button v-if="searchQuery" variant="outline" @click="searchQuery = ''; handleSearchInput()">Xoá tìm kiếm</Button>
        </Card>
        <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <EventCard v-for="event in eventStore.events" :key="event.id" :event="event" />
        </div>
      </section>

      <nav v-if="totalPages > 1" aria-label="Phân trang sự kiện" class="flex items-center justify-center gap-2 pt-2 sm:gap-4">
        <Button variant="outline" @click="changePage(currentPage - 1)" :disabled="currentPage === 1">Trước</Button>
        <span class="text-sm text-muted-foreground tabular-nums">Trang <strong class="font-semibold text-foreground">{{ currentPage }}</strong> / {{ totalPages }}</span>
        <Button variant="outline" @click="changePage(currentPage + 1)" :disabled="currentPage === totalPages">Sau</Button>
      </nav>
    </div>
  </div>
</template>
