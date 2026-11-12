<script setup lang="ts">
import { computed, ref, reactive, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import { useAuthStore } from '../stores/auth';
import EventCard from '../components/EventCard.vue';
import FeaturedEvents from '../components/FeaturedEvents.vue';
import { Search, CalendarSearch, CircleAlert, Plus, SlidersHorizontal, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EVENT_CATEGORIES } from '@/utils/categories';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
const total = ref<number | null>(null);
const hasActiveFilters = computed(() => searchQuery.value !== '' || Object.values(filters).some(value => value !== ''));
const activeFilterCount = computed(() => [filters.from, filters.to, filters.minPrice, filters.maxPrice, filters.location].filter(value => value !== '').length);
const selectedFilters = computed(() => {
  const dateLabel = (value: string) => value.split('-').reverse().slice(0, 2).join('/');
  const priceLabel = (value: string | number) => Number(value).toLocaleString('vi-VN') + 'đ';
  return [
    { key: 'search', label: searchQuery.value },
    { key: 'category', label: EVENT_CATEGORIES.find(item => item.value === filters.category)?.label ?? filters.category },
    { key: 'location', label: filters.location },
    { key: 'from', label: filters.from ? `Từ ${dateLabel(filters.from)}` : '' },
    { key: 'to', label: filters.to ? `Đến ${dateLabel(filters.to)}` : '' },
    { key: 'minPrice', label: filters.minPrice !== '' ? `≥ ${priceLabel(filters.minPrice)}` : '' },
    { key: 'maxPrice', label: filters.maxPrice !== '' ? `≤ ${priceLabel(filters.maxPrice)}` : '' },
  ].filter(item => item.label !== '') as { key: keyof typeof filters | 'search'; label: string }[];
});

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
      total.value = res.pagination.total;
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
  // `route` là toàn cục: khi rời trang chủ, query đổi theo trang mới và watcher
  // chạy thêm một lần trước khi component bị huỷ. Bỏ qua để khỏi gọi API thừa.
  if (route.name !== 'Home') return;
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
    <div class="mx-auto max-w-6xl min-w-0 space-y-10">
      <header class="flex flex-wrap items-center justify-between gap-5 pt-4">
        <div class="min-w-0 space-y-3">
          <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight">Khám phá sự kiện</h1>
          <p class="text-sm leading-6 text-muted-foreground sm:text-base">Tìm trải nghiệm mới, kết nối những điều bạn yêu.</p>
        </div>
        <Button v-if="authStore.isOrganizer" class="shrink-0" @click="router.push({ name: 'CreateEvent' })"><Plus class="size-4" aria-hidden="true" />Tạo sự kiện</Button>
      </header>

      <FeaturedEvents v-if="!hasActiveFilters && status === 'upcoming' && currentPage === 1" />

      <div class="sticky top-16 z-20 min-w-0 space-y-3 border-b border-border bg-surface/95 py-3">
        <div class="flex min-w-0 items-center gap-2 sm:gap-3">
          <div class="relative min-w-0 flex-1">
            <Label for="event-search" class="sr-only">Tìm kiếm sự kiện</Label>
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="event-search" v-model="searchQuery" type="search" placeholder="Tìm sự kiện, địa điểm…" class="h-11 w-full min-w-0 bg-background pl-10" @update:model-value="handleSearchInput" />
          </div>
          <div class="hidden shrink-0 sm:block">
            <Label for="filter-location" class="sr-only">Thành phố</Label>
            <Select :model-value="filters.location || 'all'" @update:model-value="value => { filters.location = String(value) === 'all' ? '' : String(value); handleSearchInput(); }">
              <SelectTrigger id="filter-location" class="h-11 w-40 bg-background"><SelectValue placeholder="Thành phố" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Thành phố</SelectItem>
                <SelectItem v-for="city in ['Hà Nội', 'TP.HCM', 'Đà Nẵng']" :key="city" :value="city">{{ city }}</SelectItem>
                <SelectItem v-if="filters.location && !['Hà Nội', 'TP.HCM', 'Đà Nẵng'].includes(filters.location)" :value="filters.location">{{ filters.location }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Popover v-model:open="filtersOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" class="h-11 shrink-0 bg-background"><SlidersHorizontal class="size-4" aria-hidden="true" />Bộ lọc<span v-if="activeFilterCount > 0" class="flex size-5 items-center justify-center rounded-full bg-primary text-xs tabular-nums text-primary-foreground" aria-label="Số bộ lọc đang bật">{{ activeFilterCount }}</span></Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-80" aria-label="Bộ lọc sự kiện">
              <p class="font-semibold">Tinh chỉnh tìm kiếm</p>
              <div class="grid grid-cols-2 gap-3">
                <div class="min-w-0 space-y-2"><Label for="filter-from">Từ ngày</Label><Input id="filter-from" v-model="filters.from" type="date" class="w-full min-w-0 bg-background" @update:model-value="handleSearchInput" /></div>
                <div class="min-w-0 space-y-2"><Label for="filter-to">Đến ngày</Label><Input id="filter-to" v-model="filters.to" type="date" class="w-full min-w-0 bg-background" @update:model-value="handleSearchInput" /></div>
                <div class="min-w-0 space-y-2"><Label for="filter-min-price">Giá thấp nhất (VNĐ)</Label><Input id="filter-min-price" v-model="filters.minPrice" type="number" min="0" placeholder="Không giới hạn" class="min-w-0 bg-background" @update:model-value="handleSearchInput" /></div>
                <div class="min-w-0 space-y-2"><Label for="filter-max-price">Giá cao nhất (VNĐ)</Label><Input id="filter-max-price" v-model="filters.maxPrice" type="number" min="0" placeholder="Không giới hạn" class="min-w-0 bg-background" @update:model-value="handleSearchInput" /></div>
              </div>
              <div class="space-y-2 sm:hidden">
                <Label for="filter-location-mobile">Thành phố</Label>
                <Select :model-value="filters.location || 'all'" @update:model-value="value => { filters.location = String(value) === 'all' ? '' : String(value); handleSearchInput(); }">
                  <SelectTrigger id="filter-location-mobile" class="w-full bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả thành phố</SelectItem>
                    <SelectItem v-for="city in ['Hà Nội', 'TP.HCM', 'Đà Nẵng']" :key="city" :value="city">{{ city }}</SelectItem>
                    <SelectItem v-if="filters.location && !['Hà Nội', 'TP.HCM', 'Đà Nẵng'].includes(filters.location)" :value="filters.location">{{ filters.location }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex justify-end border-t border-border pt-3"><Button variant="ghost" @click="searchQuery = ''; clearFilters()">Xoá bộ lọc</Button></div>
            </PopoverContent>
          </Popover>
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Danh mục sự kiện">
          <button type="button" :aria-pressed="filters.category === ''" class="h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring" :class="filters.category === '' ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted'" @click="filters.category = ''; handleSearchInput()">Tất cả</button>
          <button v-for="item in EVENT_CATEGORIES" :key="item.value" type="button" :aria-pressed="filters.category === item.value" class="h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring" :class="filters.category === item.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted'" @click="filters.category = item.value; handleSearchInput()">{{ item.label }}</button>
        </div>
      </div>

      <section aria-label="Danh sách sự kiện" :aria-busy="eventStore.loading || !loaded" class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="text-xl sm:text-2xl font-bold tracking-tight">{{ searchQuery ? 'Kết quả tìm kiếm' : 'Sự kiện dành cho bạn' }}<span v-if="total !== null && !eventStore.loading && !errorMessage" class="ml-2 text-sm font-normal tabular-nums text-muted-foreground">({{ total.toLocaleString('vi-VN') }})</span></h2>
          <Tabs :model-value="status" @update:model-value="changeStatus">
            <TabsList aria-label="Trạng thái sự kiện">
              <TabsTrigger value="upcoming">Sắp diễn ra</TabsTrigger>
              <TabsTrigger value="ended">Đã kết thúc</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2" aria-label="Bộ lọc đang bật">
          <span v-for="item in selectedFilters" :key="item.key" class="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background py-1 pl-3 pr-1 text-xs">
            <span class="min-w-0 truncate">{{ item.label }}</span>
            <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`Xoá bộ lọc ${item.label}`" @click="item.key === 'search' ? searchQuery = '' : filters[item.key] = ''; handleSearchInput()"><X class="size-3" aria-hidden="true" /></button>
          </span>
          <button type="button" class="px-2 py-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" @click="searchQuery = ''; clearFilters()">Xoá tất cả</button>
        </div>
        <div v-if="eventStore.loading || !loaded" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Đang tải sự kiện">
          <Card v-for="n in 8" :key="n" aria-hidden="true" class="shadow-none ring-0 border border-border bg-background gap-0 rounded-lg py-0">
            <Skeleton class="aspect-video w-full rounded-none" />
            <div class="space-y-3 p-4">
              <Skeleton class="h-5 w-full" /><Skeleton class="h-5 w-2/3" />
              <Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-3/4" />
              <div class="flex items-center justify-between border-t pt-4"><Skeleton class="h-8 w-24" /><Skeleton class="h-8 w-16" /></div>
            </div>
          </Card>
        </div>
        <Card v-else-if="errorMessage" role="alert" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg px-5 py-14 text-center">
          <CircleAlert class="size-12 text-danger" aria-hidden="true" />
          <div><h3 class="text-lg font-semibold tracking-tight">Không tải được dữ liệu</h3><p class="mt-2 break-words text-sm text-muted-foreground">{{ errorMessage }}</p></div>
          <Button @click="loadEvents">Thử lại</Button>
        </Card>
        <Card v-else-if="eventStore.events.length === 0" class="shadow-none ring-0 border border-border bg-background items-center rounded-lg px-5 py-14 text-center">
          <div class="rounded-lg bg-muted p-4"><CalendarSearch class="size-10 text-muted-foreground" aria-hidden="true" /></div>
          <div><h3 class="text-lg font-semibold tracking-tight">{{ status === 'ended' ? 'Chưa có sự kiện nào đã kết thúc' : 'Không tìm thấy sự kiện phù hợp' }}</h3><p class="mt-2 text-sm text-muted-foreground">Thử từ khóa khác hoặc quay lại sau để khám phá sự kiện mới.</p></div>
          <Button v-if="hasActiveFilters" variant="outline" @click="searchQuery = ''; clearFilters()">Xoá bộ lọc</Button>
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
