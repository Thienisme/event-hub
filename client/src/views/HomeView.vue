<script setup lang="ts">
import { computed, ref, reactive, watch, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import { useAuthStore } from '../stores/auth';
import EventCard from '../components/EventCard.vue';
import FeaturedEvents from '../components/FeaturedEvents.vue';
import DatePicker from '@/components/DatePicker.vue';
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
const filters = reactive({ category: '', location: '', from: '', to: '', minPrice: '', maxPrice: '' });
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
const resultsSection = ref<HTMLElement | null>(null);
const hasActiveFilters = computed(() => searchQuery.value !== '' || Object.values(filters).some(value => value !== ''));
const drafts = reactive({ from: '', to: '', minPrice: '', maxPrice: '' });
const dateInvalid = computed(() => !!drafts.from && !!drafts.to && drafts.from > drafts.to);
const priceInvalid = computed(() => drafts.minPrice !== '' && drafts.maxPrice !== '' && Number(drafts.minPrice) > Number(drafts.maxPrice));
const activeFilterCount = computed(() => [!!(filters.from || filters.to), filters.minPrice !== '' || filters.maxPrice !== '', !!filters.location].filter(Boolean).length);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (day: string, count: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
const saturday = addDays(today, weekday === 0 ? 0 : 6 - weekday);
const monthEnd = new Date(`${today}T00:00:00Z`);
monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
const datePresets = [
  { label: 'Hôm nay', from: today, to: today },
  { label: 'Ngày mai', from: addDays(today, 1), to: addDays(today, 1) },
  { label: 'Cuối tuần này', from: saturday, to: weekday === 0 ? today : addDays(saturday, 1) },
  { label: '7 ngày tới', from: today, to: addDays(today, 6) },
  { label: 'Tháng này', from: today, to: monthEnd.toISOString().slice(0, 10) },
];
const pricePresets = [
  { label: 'Miễn phí', minPrice: '0', maxPrice: '0' },
  { label: 'Dưới 200.000đ', minPrice: '', maxPrice: '200000' },
  { label: '200.000đ – 500.000đ', minPrice: '200000', maxPrice: '500000' },
  { label: 'Trên 500.000đ', minPrice: '500000', maxPrice: '' },
];
const chipClass = 'h-8 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring';
const chipState = (selected: boolean) => selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted';
const formatPrice = (value: string) => value === '' ? '' : value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function applyDates() {
  if (dateInvalid.value) return;
  Object.assign(filters, { from: drafts.from, to: drafts.to });
  handleSearchInput();
}
function applyPrices() {
  if (priceInvalid.value) return;
  Object.assign(filters, { minPrice: drafts.minPrice, maxPrice: drafts.maxPrice });
  handleSearchInput();
}
function updatePrice(key: 'minPrice' | 'maxPrice', value: string | number) {
  drafts[key] = String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  applyPrices();
}
function updatePriceInput(key: 'minPrice' | 'maxPrice', event: Event) {
  const input = event.target as HTMLInputElement;
  const digitsBeforeCursor = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  updatePrice(key, input.value);
  input.value = formatPrice(drafts[key]);
  let position = 0;
  let digits = 0;
  while (position < input.value.length && digits < digitsBeforeCursor) {
    if (/\d/.test(input.value[position]!)) digits++;
    position++;
  }
  input.setSelectionRange(position, position);
}
function resetPanel() {
  Object.assign(drafts, { from: '', to: '', minPrice: '', maxPrice: '' });
  Object.assign(filters, drafts, { location: '' });
  handleSearchInput();
}
function removeFilter(key: string) {
  if (key === 'search') searchQuery.value = '';
  else if (key === 'date') {
    drafts.from = drafts.to = filters.from = filters.to = '';
  } else if (key === 'price') {
    drafts.minPrice = drafts.maxPrice = filters.minPrice = filters.maxPrice = '';
  } else if (key === 'category' || key === 'location') filters[key] = '';
  handleSearchInput();
}
// Lịch nằm trong portal nên giữ bảng cha mở khi tương tác với lịch.
function keepCalendarOpen(event: CustomEvent<{ originalEvent: Event }>) {
  const target = event.detail.originalEvent.target;
  if (target instanceof Element && target.closest('[data-date-picker-calendar]')) event.preventDefault();
}
const selectedFilters = computed(() => {
  const dateLabel = (value: string) => value.split('-').reverse().slice(0, 2).join('/');
  const priceLabel = (value: string) => formatPrice(value) + 'đ';
  const preset = datePresets.find(item => item.from === filters.from && item.to === filters.to);
  const date = preset?.label ?? (filters.from && filters.to ? filters.from === filters.to ? dateLabel(filters.from) : `${dateLabel(filters.from)} – ${dateLabel(filters.to)}` : filters.from ? `Từ ${dateLabel(filters.from)}` : filters.to ? `Đến ${dateLabel(filters.to)}` : '');
  const price = filters.minPrice === '0' && filters.maxPrice === '0' ? 'Miễn phí'
    : filters.minPrice !== '' && filters.maxPrice !== '' ? `${priceLabel(filters.minPrice)} – ${priceLabel(filters.maxPrice)}`
    : filters.minPrice !== '' ? `Từ ${priceLabel(filters.minPrice)}` : filters.maxPrice !== '' ? `Dưới ${priceLabel(filters.maxPrice)}` : '';
  return [
    { key: 'search', label: searchQuery.value ? `"${searchQuery.value}"` : '' },
    { key: 'category', label: filters.category ? `Danh mục: ${EVENT_CATEGORIES.find(item => item.value === filters.category)?.label ?? filters.category}` : '' },
    { key: 'location', label: filters.location },
    { key: 'date', label: date },
    { key: 'price', label: price },
  ].filter(item => item.label !== '');
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
const changePage = async (page: number) => {
  if (page < 1 || page > totalPages.value || eventStore.loading) return;
  clearTimeout(searchTimer);
  currentPage.value = page;
  await syncQuery();
  await nextTick();
  resultsSection.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
  Object.assign(drafts, { from: filters.from, to: filters.to, minPrice: filters.minPrice, maxPrice: filters.maxPrice });
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

      <div class="sticky top-16 z-20 min-w-0 space-y-3 border-b border-border bg-surface py-3">
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
            <PopoverContent align="end" class="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0 shadow-none border border-border" aria-label="Bộ lọc sự kiện" @interact-outside="keepCalendarOpen">
              <div class="max-h-[70dvh] overflow-y-auto divide-y divide-border">
                <div class="p-4 space-y-3">
                  <h3 class="text-sm font-semibold">Thời gian</h3>
                  <div class="flex flex-wrap gap-2" role="group" aria-label="Thời gian nhanh">
                    <button v-for="item in datePresets" :key="item.label" type="button" :class="[chipClass, chipState(drafts.from === item.from && drafts.to === item.to)]" :aria-pressed="drafts.from === item.from && drafts.to === item.to" @click="Object.assign(drafts, { from: item.from, to: item.to }); applyDates()">{{ item.label }}</button>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="min-w-0 space-y-2"><Label for="filter-from">Từ ngày</Label><DatePicker id="filter-from" v-model="drafts.from" placeholder="Chọn ngày" :invalid="dateInvalid" :aria-describedby="dateInvalid ? 'date-filter-error' : undefined" @update:model-value="applyDates" /></div>
                    <div class="min-w-0 space-y-2"><Label for="filter-to">Đến ngày</Label><DatePicker id="filter-to" v-model="drafts.to" placeholder="Chọn ngày" :min="drafts.from" :invalid="dateInvalid" :aria-describedby="dateInvalid ? 'date-filter-error' : undefined" @update:model-value="applyDates" /></div>
                  </div>
                  <p v-if="dateInvalid" id="date-filter-error" role="alert" class="text-xs text-danger">Ngày kết thúc phải sau ngày bắt đầu.</p>
                </div>
                <div class="p-4 space-y-3">
                  <h3 class="text-sm font-semibold">Giá vé</h3>
                  <div class="flex flex-wrap gap-2" role="group" aria-label="Khoảng giá nhanh">
                    <button v-for="item in pricePresets" :key="item.label" type="button" :class="[chipClass, chipState(drafts.minPrice === item.minPrice && drafts.maxPrice === item.maxPrice)]" :aria-pressed="drafts.minPrice === item.minPrice && drafts.maxPrice === item.maxPrice" @click="Object.assign(drafts, { minPrice: item.minPrice, maxPrice: item.maxPrice }); applyPrices()">{{ item.label }}</button>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div v-for="field in (['minPrice', 'maxPrice'] as const)" :key="field" class="min-w-0 space-y-2">
                      <Label :for="`filter-${field}`">{{ field === 'minPrice' ? 'Từ' : 'Đến' }}</Label>
                      <div class="relative">
                        <Input :id="`filter-${field}`" :model-value="formatPrice(drafts[field])" type="text" inputmode="numeric" :placeholder="field === 'minPrice' ? '0' : 'Không giới hạn'" class="h-10 min-w-0 bg-background pr-7 tabular-nums" :aria-invalid="priceInvalid || undefined" :aria-describedby="priceInvalid ? 'price-filter-error' : undefined" @input="updatePriceInput(field, $event)" />
                        <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">đ</span>
                      </div>
                    </div>
                  </div>
                  <p v-if="priceInvalid" id="price-filter-error" role="alert" class="text-xs text-danger">Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.</p>
                </div>
                <div class="p-4 space-y-3 sm:hidden">
                  <h3 class="text-sm font-semibold">Thành phố</h3>
                  <div class="flex flex-wrap gap-2" role="group" aria-label="Thành phố">
                    <button v-for="city in ['', 'Hà Nội', 'TP.HCM', 'Đà Nẵng']" :key="city" type="button" :class="[chipClass, chipState(filters.location === city)]" :aria-pressed="filters.location === city" @click="filters.location = city; handleSearchInput()">{{ city || 'Tất cả' }}</button>
                  </div>
                </div>
              </div>
              <div class="flex justify-between border-t border-border p-4"><Button variant="ghost" @click="resetPanel">Xoá bộ lọc</Button><Button @click="filtersOpen = false">Xong</Button></div>
            </PopoverContent>
          </Popover>
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Danh mục sự kiện">
          <button type="button" :aria-pressed="filters.category === ''" class="h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring" :class="filters.category === '' ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted'" @click="filters.category = ''; handleSearchInput()">Tất cả</button>
          <button v-for="item in EVENT_CATEGORIES" :key="item.value" type="button" :aria-pressed="filters.category === item.value" class="h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring" :class="filters.category === item.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted'" @click="filters.category = item.value; handleSearchInput()">{{ item.label }}</button>
        </div>
        <div v-if="selectedFilters.length" class="mt-3 flex flex-wrap items-center gap-2" aria-label="Bộ lọc đang bật">
          <span v-for="item in selectedFilters" :key="item.key" class="inline-flex max-w-full items-center gap-1 h-8 rounded-full border border-border bg-background pl-3 pr-1 text-sm">
            <span class="min-w-0 truncate">{{ item.label }}</span>
            <button type="button" class="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" :aria-label="`Xoá bộ lọc ${item.label}`" @click="removeFilter(item.key)"><X class="size-3" aria-hidden="true" /></button>
          </span>
          <button type="button" class="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" @click="searchQuery = ''; clearFilters(); Object.assign(drafts, { from: '', to: '', minPrice: '', maxPrice: '' })">Xoá tất cả</button>
        </div>
      </div>

      <section ref="resultsSection" aria-label="Danh sách sự kiện" :aria-busy="eventStore.loading || !loaded" class="scroll-mt-64 space-y-6">
        <p class="sr-only" role="status">{{ eventStore.loading || !loaded ? 'Đang tìm sự kiện...' : errorMessage ? 'Không tải được danh sách sự kiện.' : `Tìm thấy ${total ?? 0} sự kiện. Trang ${currentPage}.` }}</p>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="text-xl sm:text-2xl font-bold tracking-tight">{{ searchQuery ? 'Kết quả tìm kiếm' : 'Sự kiện dành cho bạn' }}<span v-if="total !== null && !eventStore.loading && !errorMessage" class="ml-2 text-sm font-normal tabular-nums text-muted-foreground">({{ total.toLocaleString('vi-VN') }})</span></h2>
          <Tabs :model-value="status" @update:model-value="changeStatus">
            <TabsList aria-label="Trạng thái sự kiện">
              <TabsTrigger value="upcoming">Sắp diễn ra</TabsTrigger>
              <TabsTrigger value="ended">Đã kết thúc</TabsTrigger>
            </TabsList>
          </Tabs>
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
          <div><h3 class="text-lg font-semibold tracking-tight">{{ hasActiveFilters ? 'Không tìm thấy sự kiện phù hợp' : status === 'ended' ? 'Chưa có sự kiện nào đã kết thúc' : 'Chưa có sự kiện sắp diễn ra' }}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{{ hasActiveFilters ? 'Thử từ khoá khác, mở rộng khoảng ngày hoặc xoá bộ lọc để xem thêm sự kiện.' : 'Quay lại sau để khám phá những trải nghiệm mới từ các nhà tổ chức.' }}</p></div>
          <Button v-if="hasActiveFilters" variant="outline" @click="searchQuery = ''; clearFilters(); Object.assign(drafts, { from: '', to: '', minPrice: '', maxPrice: '' })">Xoá bộ lọc</Button>
        </Card>
        <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <EventCard v-for="event in eventStore.events" :key="event.id" :event="event" />
        </div>
      </section>

      <nav v-if="totalPages > 1 && !errorMessage" aria-label="Phân trang sự kiện" class="flex flex-wrap items-center justify-center gap-3 pt-2 sm:gap-4">
        <Button variant="outline" class="min-h-11" @click="changePage(currentPage - 1)" :disabled="currentPage === 1 || eventStore.loading">Trang trước</Button>
        <span class="text-sm text-muted-foreground tabular-nums">Trang <strong class="font-semibold text-foreground">{{ currentPage }}</strong> / {{ totalPages }}</span>
        <Button variant="outline" class="min-h-11" @click="changePage(currentPage + 1)" :disabled="currentPage === totalPages || eventStore.loading">Trang sau</Button>
      </nav>
    </div>
  </div>
</template>
