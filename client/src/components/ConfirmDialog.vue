<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

/**
 * Hộp thoại xác nhận, thay cho `confirm()` của trình duyệt.
 *
 * Vì sao không dùng `window.confirm`?
 * - Nó chặn (block) luồng JS của cả trang: animation đứng, mọi request đang
 *   bay bị treo -> UI "đơ" trong lúc người dùng đang cân nhắc.
 * - Không style được, không đồng bộ với phần còn lại của ứng dụng.
 * - Không cho kiểm soát được nội dung (không có tiêu đề, không có nút ở kiểu
 *   riêng).
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Nút xác nhận mang màu nguy hiểm (xoá, khoá...). */
    danger?: boolean;
    /** Đang xử lý -> nút xác nhận bị disable để tránh bấm hai lần. */
    loading?: boolean;
  }>(),
  {
    message: '',
    confirmLabel: 'Xác nhận',
    cancelLabel: 'Huỷ',
    danger: false,
    loading: false,
  }
);

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const confirmButton = ref<HTMLButtonElement | null>(null);

/** Khi mở -> đưa focus vào nút xác nhận để người dùng có thể bấm Enter ngay. */
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    confirmButton.value?.focus();
  }
);

/** Esc đóng hộp thoại. */
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open && !props.loading) {
    emit('cancel');
  }
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @keydown="onKeydown"
    >
      <!-- Lớp nền: bấm ra ngoài cũng đóng -->
      <div
        class="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
        @click="!loading && emit('cancel')"
      ></div>

      <div
        role="dialog"
        aria-modal="true"
        class="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-5"
      >
        <div class="flex items-start gap-3">
          <div
            v-if="danger"
            class="shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center"
          >
            <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>

          <div class="flex-1">
            <h3 class="text-lg font-bold text-gray-900">{{ title }}</h3>
            <p v-if="message" class="mt-2 text-sm text-gray-600 leading-relaxed">{{ message }}</p>
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-1">
          <button
            type="button"
            :disabled="loading"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmButton"
            type="button"
            :disabled="loading"
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
            :class="danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'"
            @click="emit('confirm')"
          >
            <span v-if="loading">Đang xử lý...</span>
            <span v-else>{{ confirmLabel }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
