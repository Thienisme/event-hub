<script setup lang="ts">
import { ref, watch } from 'vue';
import QRCode from 'qrcode';
import { Download } from '@lucide/vue';
import { Button } from './ui/button';

/**
 * Vẽ chuỗi QR thành ảnh.
 *
 * `qrcode` vẽ được ra canvas hoặc data URL. Dùng data URL vì ảnh tự co giãn
 * theo container bằng CSS và không cần giữ ref tới thẻ <canvas>.
 */
const props = withDefaults(
  defineProps<{
    value: string;
    /** Cạnh tối đa của ảnh (px). Ảnh vẫn thu nhỏ được theo bề rộng container. */
    size?: number;
    downloadName?: string;
  }>(),
  { size: 160 }
);

const dataUrl = ref('');
const failed = ref(false);

watch(
  () => [props.value, props.size, props.downloadName] as const,
  async ([value, size, downloadName], _, onCleanup) => {
    let active = true;
    onCleanup(() => { active = false; });
    failed.value = false;
    dataUrl.value = '';

    if (!value) {
      dataUrl.value = '';
      return;
    }

    try {
      const result = await QRCode.toDataURL(value, {
        width: downloadName ? Math.max(size, 768) : size,
        margin: 4,
        errorCorrectionLevel: 'M',
      });
      if (active) dataUrl.value = result;
    } catch {
      if (!active) return;
      // Chuỗi quá dài hoặc lỗi nội bộ thư viện -> báo trên UI thay vì ảnh vỡ.
      dataUrl.value = '';
      failed.value = true;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-4">
    <!-- bg-white tại đây là chủ ý: máy quét QR cần nền trắng sau mã để đọc được
         (ảnh QR của thư viện `qrcode` có nền trong suốt), không đổi sang token khác. -->
    <img
      v-if="dataUrl"
      :src="dataUrl"
      alt="Mã QR của vé"
      class="w-full h-auto rounded-lg bg-white"
      :style="{ maxWidth: `${size}px` }"
    />
    <div v-else-if="failed" class="py-6 px-2 text-xs text-center text-danger">
      Không tạo được mã QR
    </div>
    <div v-else class="py-6 px-2 text-xs text-center text-muted-foreground">Đang tạo mã QR...</div>
    <Button v-if="downloadName && dataUrl" as-child variant="outline" class="min-h-11 w-full">
      <a :href="dataUrl" :download="downloadName"><Download class="size-4" aria-hidden="true" />Tải mã QR</a>
    </Button>
  </div>
</template>
