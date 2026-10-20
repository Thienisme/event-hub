<script setup lang="ts">
import { useToastStore } from '../stores/toast';

const toastStore = useToastStore();

const typeClass: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-white text-gray-700 border-gray-200',
};

const typeIcon: Record<string, string> = {
  success: 'M5 13l4 4L19 7',
  error: 'M6 18L18 6M6 6l12 12',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};
</script>

<template>
  <!--
    Nằm ở góc phải dưới, fixed để không ảnh hưởng flow của trang.
    z-index cao hơn header (z-10) để luôn nổi lên trên.
  -->
  <div
    class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150 ease-in absolute"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium"
        :class="typeClass[toast.type]"
      >
        <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            :d="typeIcon[toast.type]"
          />
        </svg>

        <p class="flex-1 leading-snug">{{ toast.message }}</p>

        <button
          type="button"
          class="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Đóng thông báo"
          @click="toastStore.dismiss(toast.id)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
