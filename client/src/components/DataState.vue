<script setup lang="ts">
/**
 * Bọc 3 trạng thái hiển thị dữ liệu: đang tải / lỗi / rỗng.
 *
 * Vì sao cần component này?
 * Mỗi màn hình có bảng danh sách đều lặp lại đúng 4 khối markup (skeleton,
 * lỗi, rỗng, nội dung) + logic "đã gọi API lần nào chưa". Khi logic đó nằm rải
 * rác ở từng view thì dễ quên mất cờ `loaded`, và hậu quả là UI nháy lên
 * thông báo "không có dữ liệu" trong khoảnh khắc đầu tiên (lúc chưa có
 * response nào về).
 *
 * Cờ `loaded` được đưa vào đây để mọi màn hình hành xử giống nhau.
 */
withDefaults(
  defineProps<{
    /** Đang tải dữ liệu. */
    loading?: boolean;
    /** Đã gọi API ít nhất một lần chưa — phân biệt "chưa tải" với "không có dữ liệu". */
    loaded?: boolean;
    /** Message lỗi (rỗng = không lỗi). */
    error?: string;
    /** Dữ liệu rỗng. */
    empty?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyActionLabel?: string;
    /** Tiêu đề khi lỗi. */
    errorTitle?: string;
  }>(),
  {
    loading: false,
    loaded: true,
    error: '',
    empty: false,
    emptyTitle: 'Chưa có dữ liệu',
    emptyDescription: '',
    emptyActionLabel: '',
    errorTitle: 'Không tải được dữ liệu',
  }
);

const emit = defineEmits<{
  (e: 'retry'): void;
  (e: 'empty-action'): void;
}>();
</script>

<template>
  <!-- Skeleton: hiện ngay cả ở lần render đầu (khi chưa có response nào) -->
  <div v-if="loading || !loaded">
    <slot name="skeleton">
      <div class="py-16 text-center text-sm text-gray-400">
        <div class="inline-block animate-pulse">Đang tải...</div>
      </div>
    </slot>
  </div>

  <!-- Lỗi: phải phân biệt với "không có dữ liệu", nếu không user tưởng hết dữ liệu -->
  <div
    v-else-if="error"
    class="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm"
  >
    <svg class="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
    <h3 class="mt-2 text-sm font-medium text-gray-900">{{ errorTitle }}</h3>
    <p class="mt-1 text-sm text-gray-500">{{ error }}</p>
    <button
      type="button"
      class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
      @click="emit('retry')"
    >
      Thử lại
    </button>
  </div>

  <!-- Rỗng -->
  <div
    v-else-if="empty"
    class="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm"
  >
    <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <h3 class="mt-2 text-sm font-medium text-gray-900">{{ emptyTitle }}</h3>
    <p v-if="emptyDescription" class="mt-1 text-sm text-gray-500">{{ emptyDescription }}</p>
    <button
      v-if="emptyActionLabel"
      type="button"
      class="mt-6 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
      @click="emit('empty-action')"
    >
      {{ emptyActionLabel }}
    </button>
  </div>

  <!-- Có dữ liệu -->
  <slot v-else />
</template>
