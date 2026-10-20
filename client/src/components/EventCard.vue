<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime, formatPrice } from '../utils/format';
// Dùng chung type với store để tránh lệch kiểu (vd description có thể là null từ Prisma)
import type { EventItem } from '../stores/event';
import EventBanner from './EventBanner.vue';

const props = defineProps<{
  event: EventItem;
}>();

// Tính giá vé thấp nhất để hiển thị kiểu "Từ xxx.xxx VNĐ"
const minPrice = computed(() => {
  if (!props.event.ticketTypes || props.event.ticketTypes.length === 0) return null;
  const prices = props.event.ticketTypes.map((t) => Number(t.price));
  return Math.min(...prices);
});

// Format ngày tháng hiển thị đẹp mắt (dùng chung với các trang khác)
const formatDate = (dateString: string) => formatDateTime(dateString);
</script>

<template>
  <div class="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100 overflow-hidden flex flex-col h-full">
    <!-- Banner Event (class `group` để ảnh zoom khi hover cả card) -->
    <div class="group relative h-48 bg-gray-100 overflow-hidden">
      <EventBanner :src="event.bannerUrl" :alt="event.title" />
    </div>

    <!-- Nội dung Event -->
    <div class="p-5 flex-1 flex flex-col justify-between">
      <div>
        <!-- Thời gian -->
        <p class="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">
          {{ formatDate(event.startTime) }} - {{ formatDate(event.endTime) }}
        </p>

        <!-- Tiêu đề -->
        <h3 class="text-lg font-bold text-gray-900 line-clamp-2 hover:text-indigo-600 transition-colors">
          {{ event.title }}
        </h3>

        <!-- Địa điểm -->
        <p class="mt-2 text-sm text-gray-500 flex items-center gap-1 line-clamp-1">
          <svg class="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {{ event.location }}
        </p>
      </div>

      <!-- Footer Card: Giá & Nút Chi tiết -->
      <div class="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
        <div>
          <span class="text-xs text-gray-500 block">Giá từ</span>
          <span class="text-base font-extrabold text-indigo-600">
            <!--
              Phân biệt 3 trường hợp: chưa cấu hình loại vé / giá 0 / có giá.
              Trước đây gộp chung null thành "Miễn phí" nên sự kiện chưa mở bán
              bị hiển thị nhầm là vé miễn phí.
            -->
            {{ minPrice === null ? 'Chưa mở bán' : minPrice === 0 ? 'Miễn phí' : formatPrice(minPrice) }}
          </span>
        </div>

        <router-link
          :to="`/events/${event.id}`"
          class="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-sm font-semibold rounded-lg transition-colors"
        >
          Xem chi tiết
        </router-link>
      </div>
    </div>
  </div>
</template>