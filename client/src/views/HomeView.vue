<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useEventStore } from '../stores/event';
import { useAuthStore } from '../stores/auth';
import EventCard from '../components/EventCard.vue';

const router = useRouter();
const eventStore = useEventStore();
const authStore = useAuthStore();

const searchQuery = ref('');
const currentPage = ref(1);
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
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-8">
      
      <!-- Header & Search Bar -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">
            Sự kiện nổi bật
          </h1>
          <p class="mt-1 text-sm text-gray-500">
            Khám phá và đặt vé cho các sự kiện hot nhất ngay hôm nay
          </p>
        </div>

        <div class="flex items-center gap-4">
          <!-- Nút tạo sự kiện (chỉ organizer/admin) -->
          <button
            v-if="authStore.isOrganizer"
            @click="router.push({ name: 'CreateEvent' })"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            + Tạo sự kiện
          </button>

          <!-- Ô Tìm kiếm -->
          <div class="relative w-full md:w-80">
            <input
              v-model="searchQuery"
              @input="handleSearchInput"
              type="text"
              placeholder="Tìm theo tên sự kiện, địa điểm..."
              class="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition-all"
            />
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- State: Đang tải (gộp !loaded để lần render đầu cũng hiện skeleton) -->
      <div v-if="eventStore.loading || !loaded" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div v-for="n in 8" :key="n" class="bg-white rounded-xl h-80 animate-pulse border border-gray-100 p-4">
          <div class="bg-gray-200 h-40 rounded-lg mb-4"></div>
          <div class="bg-gray-200 h-4 rounded w-3/4 mb-2"></div>
          <div class="bg-gray-200 h-4 rounded w-1/2"></div>
        </div>
      </div>

      <!-- State: Lỗi tải -->
      <div v-else-if="errorMessage" class="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <svg class="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900">Không tải được sự kiện</h3>
        <p class="mt-1 text-sm text-gray-500">{{ errorMessage }}</p>
        <button
          class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          @click="loadEvents"
        >
          Thử lại
        </button>
      </div>

      <!-- State: Không có dữ liệu -->
      <div v-else-if="eventStore.events.length === 0" class="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900">Không tìm thấy sự kiện nào</h3>
        <p class="mt-1 text-sm text-gray-500">Thử thay đổi từ khóa tìm kiếm của bạn xem sao.</p>
      </div>

      <!-- State: Grid Sự kiện -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <EventCard
          v-for="event in eventStore.events"
          :key="event.id"
          :event="event"
        />
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-6">
        <button
          @click="changePage(currentPage - 1)"
          :disabled="currentPage === 1"
          class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Trước
        </button>

        <span class="text-sm text-gray-600 px-3">
          Trang <strong class="text-gray-900">{{ currentPage }}</strong> / {{ totalPages }}
        </span>

        <button
          @click="changePage(currentPage + 1)"
          :disabled="currentPage === totalPages"
          class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Sau
        </button>
      </div>

    </div>
  </div>
</template>