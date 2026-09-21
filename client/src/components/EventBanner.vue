<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  src?: string | null;
  alt: string;
}>();

/**
 * Dữ liệu seed đang trỏ tới https://example.com/banner.jpg -> HTTP 404.
 * Nếu render <img> trần thì trình duyệt hiện icon ảnh vỡ (biểu tượng núi gãy)
 * trông rất mất thẩm mỹ. Nên bắt sự kiện error và tự vẽ placeholder.
 *
 * Placeholder cố tình vẽ bằng Tailwind (gradient + chữ) chứ KHÔNG dùng
 * via.placeholder.com: dịch vụ đó đã ngừng hoạt động (curl trả HTTP 000),
 * và phụ thuộc mạng ngoài thì lúc nào cũng có nguy cơ vỡ lại.
 */
const broken = ref(false);

// Đổi sự kiện/URL khác -> cho phép thử lại ảnh mới
watch(
  () => props.src,
  () => {
    broken.value = false;
  }
);
</script>

<template>
  <div class="w-full h-full overflow-hidden">
    <img
      v-if="src && !broken"
      :src="src"
      :alt="alt"
      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
      @error="broken = true"
    />

    <div
      v-else
      class="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 transition-transform duration-300 group-hover:scale-105"
    >
      <span class="px-4 text-center text-sm font-semibold text-white/90 line-clamp-2">
        {{ alt }}
      </span>
    </div>
  </div>
</template>
