<script setup lang="ts">
import { useToastStore } from '../stores/toast';

const toastStore = useToastStore();

const typeClass: Record<string, string> = {
  success: 'text-success border-success/30',
  error: 'text-danger border-danger/30',
  info: 'text-foreground border-border',
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
    class="pointer-events-none fixed top-20 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:top-auto sm:bottom-[max(1rem,env(safe-area-inset-bottom))]"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150 ease-in absolute motion-reduce:transition-none"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border bg-background text-sm font-medium"
        :class="typeClass[toast.type]"
      >
        <svg class="mt-0.5 w-5 h-5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            :d="typeIcon[toast.type]"
          />
        </svg>

        <p class="min-w-0 flex-1 break-words leading-6 text-foreground">{{ toast.message }}</p>

        <button
          type="button"
          class="-mr-2 -my-2 flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
