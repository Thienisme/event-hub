<script setup lang="ts">
import { ref, watch } from 'vue';
import QRCode from 'qrcode';

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
  }>(),
  { size: 160 }
);

const dataUrl = ref('');
const failed = ref(false);

watch(
  () => [props.value, props.size] as const,
  async ([value, size]) => {
    failed.value = false;

    if (!value) {
      dataUrl.value = '';
      return;
    }

    try {
      dataUrl.value = await QRCode.toDataURL(value, {
        width: size,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch {
      // Chuỗi quá dài hoặc lỗi nội bộ thư viện -> báo trên UI thay vì ảnh vỡ.
      dataUrl.value = '';
      failed.value = true;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="flex items-center justify-center">
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
  </div>
</template>
