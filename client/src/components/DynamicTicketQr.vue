<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import QrCodeImage from './QrCodeImage.vue';
import { QR_STEP_SECONDS, buildDynamicQr, canUseDynamicQr } from '../utils/dynamicQr';

/**
 * Mã QR động: chuỗi trong mã đổi mỗi 30 giây (HMAC theo hợp đồng với server),
 * kèm thanh đếm ngược tới lần đổi mã và đồng hồ nhấp nháy để nhân viên phân
 * biệt màn hình thật với ảnh chụp. Không cho tải mã động xuống.
 */
const props = withDefaults(
  defineProps<{
    ticketId: string;
    qrCode: string;
    /** Cạnh tối đa của ảnh QR (px), như QrCodeImage. */
    size?: number;
    /** Lệch đồng hồ server (ms): Date.parse(serverTime) - Date.now(). */
    offsetMs?: number;
  }>(),
  { size: 132, offsetMs: 0 }
);

const dynamicSupported = canUseDynamicQr();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const serverNowMs = computed(() => now.value + props.offsetMs);

const secondsIntoStep = computed(() => Math.floor(serverNowMs.value / 1000) % QR_STEP_SECONDS);
const secondsRemaining = computed(() => QR_STEP_SECONDS - secondsIntoStep.value);
/** Thanh đếm ngược co lại tới lần đổi mã. */
const progressPercent = computed(() => (secondsRemaining.value / QR_STEP_SECONDS) * 100);

const clock = computed(() => {
  const d = new Date(serverNowMs.value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const step = computed(() => Math.floor(serverNowMs.value / 1000 / QR_STEP_SECONDS));

const dynamicValue = ref('');
const ready = ref(false);

watch(
  () => [props.ticketId, props.qrCode, step.value] as const,
  async ([ticketId, qrCode], _, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    // Không xoá mã cũ trong lúc tính mã mới: tránh màn hình nháy trắng mỗi 30 giây.

    if (!dynamicSupported || !ticketId || !qrCode) {
      dynamicValue.value = qrCode;
      ready.value = true;
      return;
    }

    try {
      const value = await buildDynamicQr(ticketId, qrCode, serverNowMs.value);
      if (active) {
        dynamicValue.value = value;
        ready.value = true;
      }
    } catch {
      // Lỗi nội bộ hiếm gặp -> dùng mã tĩnh thay vì để trống màn hình vé.
      if (active) {
        dynamicValue.value = qrCode;
        ready.value = true;
      }
    }
  },
  { immediate: true }
);

const displayValue = computed(() => {
  if (!dynamicSupported) return props.qrCode;
  return ready.value ? dynamicValue.value : '';
});
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3">
    <QrCodeImage :value="displayValue" :size="size" />
    <template v-if="dynamicSupported">
      <div class="w-full space-y-1.5" :style="{ maxWidth: `${size}px` }">
        <div class="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            class="h-full rounded-full bg-primary transition-all duration-1000 motion-reduce:transition-none"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="tabular-nums">Mã đổi sau {{ secondsRemaining }}s</span>
          <span class="inline-flex items-center gap-1.5 tabular-nums">
            <span class="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden="true" />
            {{ clock }}
          </span>
        </div>
      </div>
    </template>
    <p v-else class="text-center text-xs text-muted-foreground">
      Trình duyệt không hỗ trợ mã động, đang dùng mã tĩnh
    </p>
  </div>
</template>
