<script setup lang="ts">
import { nextTick, ref, useAttrs, useId } from 'vue';
import { Eye, EyeOff } from '@lucide/vue';
import { Input } from '@/components/ui/input';

defineOptions({ inheritAttrs: false });
defineProps<{ modelValue?: string | number }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>();
const attrs = useAttrs();
const generatedId = useId();
const wrapper = ref<HTMLDivElement | null>(null);
const visible = ref(false);
let pointerFocused = false;

function rememberFocus() {
  pointerFocused = document.activeElement === wrapper.value?.querySelector('input');
}

async function toggle() {
  const input = wrapper.value?.querySelector('input');
  const restoreFocus = pointerFocused || document.activeElement === input;
  const start = input?.selectionStart;
  const end = input?.selectionEnd;
  const direction = input?.selectionDirection;
  pointerFocused = false;
  visible.value = !visible.value;
  await nextTick();
  if (input && restoreFocus) {
    input.focus({ preventScroll: true });
    if (start != null && end != null) input.setSelectionRange(start, end, direction ?? undefined);
  }
}
</script>

<template>
  <div ref="wrapper" class="relative">
    <Input
      v-bind="$attrs"
      :id="($attrs.id as string | undefined) ?? generatedId"
      :model-value="modelValue"
      :type="visible ? 'text' : 'password'"
      :class="['pr-10', attrs.class]"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 my-auto flex size-9 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
      :aria-pressed="visible"
      :aria-controls="($attrs.id as string | undefined) ?? generatedId"
      @pointerdown="rememberFocus"
      @pointercancel="pointerFocused = false"
      @click="toggle"
    >
      <component :is="visible ? EyeOff : Eye" class="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  </div>
</template>
