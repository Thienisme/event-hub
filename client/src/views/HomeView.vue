<script setup lang="ts">
import { ref, reactive, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import { useAuthStore } from '../stores/auth';
import EventCard from '../components/EventCard.vue';
import { Search, CalendarSearch, CircleAlert, Plus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EVENT_CATEGORIES } from '@/utils/categories';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const router = useRouter();
const route = useRoute();
const filters = reactive({ category: '', location: '', from: '', to: '', minPrice: '' as string | number, maxPrice: '' as string | number });
const filtersOpen = ref(false);
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
        ...filters,
      },
      controller.signal
    );

    if (controller.signal.aborted) return;
    if (res?.pagination) {
      totalPages.value = res.pagination.totalPages;
    }
  } catch (error: any) {
    // Request bị chính mình huỷ -> không phải lỗi, đừng hiện thông báo.
    if (controller.signal.aborted || error?.code === 'ERR_CANCELED') return;
    // Trước đây lỗi mạng không được bắt: BE chết thì UI hiện "Không tìm thấy 
    // sự kiện nào", khiến user tưởng hết dữ liệu thay vì biết là mất kết nối.
    errorMessage.value =
      error.response?.data?.message || 'Không tải được danh sách sự kiện!';
  } finally {
    if (!controller.signal.aborted) loaded.value = true;
  }
};

// URL là nguồn dữ liệu khi mở liên kết hoặc dùng Back/Forward.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const syncQuery = async () => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries({ search: searchQuery.value, ...filters, page: currentPage.value })) {
    if (String(value).trim() !== '') query[key] = String(value);
  }
  if (status.value === 'ended') query.status = 'ended';
  // Cùng URL thì watcher không chạy; vẫn cần tải lại nếu request vừa bị huỷ.
  if (router.resolve({ query }).fullPath === route.fullPath) {
    loadEvents();
    return;
  }
  await router.replace({ query });
};
const handleSearchInput = () => {
  clearTimeout(searchTimer);
  inFlight?.abort();
  currentPage.value = 1;
  searchTimer = setTimeout(syncQuery, 400);
};
const clearFilters = () => {
  Object.assign(filters, { category: '', location: '', from: '', to: '', minPrice: '', maxPrice: '' });
  handleSearchInput();
};
const changeStatus = (value: string | number) => {
  const nextStatus = value === 'ended' ? 'ended' : 'upcoming';
  if (nextStatus === status.value) return;
  clearTimeout(searchTimer);
  status.value = nextStatus;
  currentPage.value = 1;
  syncQuery();
};
const changePage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  clearTimeout(searchTimer);
  currentPage.value = page;
  syncQuery();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
watch(() => route.query, (query) => {
  clearTimeout(searchTimer);
  const read = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };
  searchQuery.value = read('search');
  filters.category = EVENT_CATEGORIES.some(item => item.value === read('category')) ? read('category') : '';
  filters.location = read('location');
  filters.from = read('from');
  filters.to = read('to');
  filters.minPrice = read('minPrice');
  filters.maxPrice = read('maxPrice');
  const page = Number(read('page'));
  currentPage.value = Number.isSafeInteger(page) && page > 0 ? page : 1;
  status.value = read('status') === 'ended' ? 'ended' : 'upcoming';
  loadEvents();
}, { immediate: true });

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
              <Input v-model="searchQuery" @update:model-value="handleSearchInput" type="search" aria-label="Tìm kiếm sự kiện" placeholder="Tìm tên sự kiện, địa điểm…" class="h-14 rounded-xl bg-card pl-12 pr-4 text-base shadow-sm" />
            </div>
            <div class="mt-4">
              <Button variant="outline" class="sm:hidden" :aria-expanded="filtersOpen" aria-controls="event-filters" @click="filtersOpen = !filtersOpen">{{ filtersOpen ? 'Thu gọn bộ lọc' : 'Mở bộ lọc' }}</Button>
              <div id="event-filters" class="mt-3 space-y-4" :class="filtersOpen ? 'block' : 'hidden sm:block'">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div class="space-y-2">
                    <Label for="filter-category">Danh mục</Label>
                    <Select :model-value="filters.category || 'all'" @update:model-value="value => { filters.category = String(value) === 'all' ? '' : String(value); handleSearchInput(); }">
                      <SelectTrigger id="filter-category" class="w-full bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Tất cả danh mục</SelectItem><SelectItem v-for="item in EVENT_CATEGORIES" :key="item.value" :value="item.value">{{ item.label }}</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div class="space-y-2">
                    <Label for="filter-location">Thành phố / địa điểm</Label>
                    <Select :model-value="filters.location || 'all'" @update:model-value="value => { filters.location = String(value) === 'all' ? '' : String(value); handleSearchInput(); }">
                      <SelectTrigger id="filter-location" class="w-full bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tất cả</SelectItem>
                        <SelectItem v-for="city in ['Hà Nội', 'TP.HCM', 'Đà Nẵng']" :key="city" :value="city">{{ city }}</SelectItem>
                        <SelectItem v-if="filters.location && !['Hà Nội', 'TP.HCM', 'Đà Nẵng'].includes(filters.location)" :value="filters.location">{{ filters.location }}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="min-w-0 space-y-2"><Label for="filter-from">Từ ngày</Label><Input id="filter-from" v-model="filters.from" type="date" class="min-w-0 bg-card" @update:model-value="handleSearchInput" /></div>
                  <div class="min-w-0 space-y-2"><Label for="filter-to">Đến ngày</Label><Input id="filter-to" v-model="filters.to" type="date" class="min-w-0 bg-card" @update:model-value="handleSearchInput" /></div>
                  <div class="space-y-2"><Label for="filter-min-price">Giá thấp nhất (VNĐ)</Label><Input id="filter-min-price" v-model="filters.minPrice" type="number" min="0" placeholder="Không giới hạn" class="bg-card" @update:model-value="handleSearchInput" /></div>
                  <div class="space-y-2"><Label for="filter-max-price">Giá cao nhất (VNĐ)</Label><Input id="filter-max-price" v-model="filters.maxPrice" type="number" min="0" placeholder="Không giới hạn" class="bg-card" @update:model-value="handleSearchInput" /></div>
                </div>
                <Button variant="outline" @click="clearFilters">Xoá bộ lọc</Button>
              </div>
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
