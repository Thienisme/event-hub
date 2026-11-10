<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import apiClient from '../api/axios';
import { resolveMediaUrl, MAX_BANNER_BYTES, ALLOWED_BANNER_TYPES } from '../utils/media';

const props = defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void;
  (e: 'uploading', value: boolean): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const isUploading = ref(false);
const progress = ref(0);
const uploadError = ref('');

/** URL http(s) bên ngoài (không phải /uploads/) -> mở sẵn ô dán URL. */
const isExternalUrl = (value?: string | null): boolean =>
  !!value && /^https?:\/\//i.test(value) && !value.startsWith('/uploads/');

const showUrlInput = ref(false);

// Khởi tạo và theo dõi: nếu modelValue là URL ngoài (vd nạp lại sự kiện ở
// chế độ sửa) thì mở sẵn ô dán URL để người dùng thấy được giá trị hiện tại.
watch(
  () => props.modelValue,
  value => {
    if (isExternalUrl(value)) {
      showUrlInput.value = true;
    }
  },
  { immediate: true }
);

const previewUrl = computed(() => resolveMediaUrl(props.modelValue) ?? undefined);

/** URL dán vào gõ dở hoặc trỏ tới ảnh không tồn tại -> báo thay vì hiện icon ảnh vỡ. */
const previewBroken = ref(false);
watch(previewUrl, () => {
  previewBroken.value = false;
});

const openPicker = () => {
  if (isUploading.value) return;
  fileInputRef.value?.click();
};

const handleFile = (file: File) => {
  // Kiểm tra ngay ở client để không phải chờ server từ chối mới biết lỗi.
  if (!ALLOWED_BANNER_TYPES.includes(file.type)) {
    uploadError.value = 'Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP!';
    return;
  }
  if (file.size > MAX_BANNER_BYTES) {
    uploadError.value = 'Ảnh không được vượt quá 5MB!';
    return;
  }
  uploadError.value = '';
  uploadFile(file);
};

const onFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  // Reset để chọn lại cùng một file vẫn kích hoạt change.
  target.value = '';
  if (file) handleFile(file);
};

const onDragOver = () => {
  if (!isUploading.value) {
    isDragging.value = true;
  }
};

const onDragLeave = () => {
  isDragging.value = false;
};

const onDrop = (event: DragEvent) => {
  isDragging.value = false;
  if (isUploading.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
};

const uploadFile = async (file: File) => {
  isUploading.value = true;
  progress.value = 0;
  emit('uploading', true);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const { data } = await apiClient.post<{ message: string; url: string }>('/uploads', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
      onUploadProgress: (progressEvent: { loaded: number; total?: number }) => {
        if (progressEvent.total) {
          progress.value = Math.round((progressEvent.loaded / progressEvent.total) * 100);
        }
      },
    });
    emit('update:modelValue', data.url);
  } catch (error: any) {
    uploadError.value =
      error.response?.data?.message || 'Tải ảnh lên thất bại, vui lòng thử lại!';
  } finally {
    isUploading.value = false;
    emit('uploading', false);
  }
};

const removeImage = () => {
  uploadError.value = '';
  emit('update:modelValue', null);
};

const onUrlInput = (event: Event) => {
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', value || null);
};
</script>

<template>
  <div>
    <!-- Đã có ảnh: xem trước 16:9 kèm nút đổi/xoá -->
    <div v-if="modelValue" class="space-y-3">
      <img
        v-if="!previewBroken"
        :src="previewUrl"
        alt="Ảnh banner sự kiện"
        class="aspect-video w-full object-cover rounded-lg border border-gray-300 bg-gray-100"
        @error="previewBroken = true"
      />
      <div
        v-else
        class="aspect-video w-full flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500"
      >
        Không tải được ảnh từ URL này
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          :disabled="isUploading"
          class="px-3 py-1.5 text-sm text-indigo-600 border border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          @click="openPicker"
        >
          Đổi ảnh
        </button>
        <button
          type="button"
          :disabled="isUploading"
          class="px-3 py-1.5 text-sm text-red-600 border border-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          @click="removeImage"
        >
          Xoá ảnh
        </button>
      </div>
    </div>

    <!-- Chưa có ảnh: vùng kéo thả, thao tác được bằng chuột và bàn phím -->
    <div
      v-else
      role="button"
      tabindex="0"
      aria-label="Tải lên ảnh banner"
      class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      :class="
        isDragging
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-gray-300 hover:border-indigo-400 bg-gray-50'
      "
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <svg
        class="mx-auto h-10 w-10 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21z"
        />
      </svg>
      <p class="mt-2 text-sm text-gray-700 font-medium">
        Kéo thả ảnh vào đây hoặc bấm để chọn
      </p>
      <p class="mt-1 text-xs text-gray-500">JPG, PNG hoặc WEBP, tối đa 5MB. Tỉ lệ đề xuất 16:9</p>
    </div>

    <!-- Thanh tiến trình khi đang tải lên -->
    <div v-if="isUploading" class="mt-2">
      <div class="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
        <div
          class="h-full bg-indigo-600 transition-all"
          :style="{ width: `${progress}%` }"
        ></div>
      </div>
      <p class="mt-1 text-xs text-gray-500 text-right">Đang tải lên... {{ progress }}%</p>
    </div>

    <!-- Lỗi upload hiển thị ngay dưới vùng upload -->
    <p v-if="uploadError" class="mt-2 text-xs text-red-600">{{ uploadError }}</p>

    <!-- Dán URL ảnh ngoài cho ai không muốn tải file lên -->
    <div class="mt-3">
      <button
        type="button"
        class="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
        @click="showUrlInput = !showUrlInput"
      >
        {{ showUrlInput ? 'Ẩn ô dán URL ảnh' : 'Hoặc dán URL ảnh' }}
      </button>
      <input
        v-if="showUrlInput"
        type="url"
        maxlength="500"
        :value="modelValue ?? ''"
        class="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
        placeholder="https://example.com/banner.jpg"
        @input="onUrlInput"
      />
    </div>

    <!-- Input file ẩn, mở bằng click/keyboard ở vùng kéo thả hoặc nút "Đổi ảnh" -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden"
      @change="onFileChange"
    />
  </div>
</template>
