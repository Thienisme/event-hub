<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { resolveMediaUrl } from '@/utils/media';

const props = defineProps<{ name?: string; url?: string | null }>();
const failed = ref(false);
const source = computed(() => resolveMediaUrl(props.url));
const initial = computed(() => Array.from(props.name?.trim() || '?')[0]?.toLocaleUpperCase('vi-VN'));
watch(source, () => { failed.value = false; });
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground font-semibold" aria-hidden="true">
    <img v-if="source && !failed" :src="source" alt="" class="size-full object-cover" @error="failed = true" />
    <span v-else>{{ initial }}</span>
  </span>
</template>
