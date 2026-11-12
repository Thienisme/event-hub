<script setup lang="ts">
import { computed, ref } from 'vue';
import { parseDate } from '@internationalized/date';
import type { DateValue } from 'reka-ui';
import { CalendarDays, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  min?: string;
  id?: string;
  invalid?: boolean;
}>(), { placeholder: 'Chọn ngày' });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
// URL có thể chứa ngày không hợp lệ; không để parseDate làm hỏng giao diện.
function safeDate(value?: string) {
  try { return value ? parseDate(value) : undefined; } catch { return undefined; }
}
const selected = computed(() => safeDate(props.modelValue));
const minimum = computed(() => safeDate(props.min));
const display = computed(() => selected.value ? props.modelValue.split('-').reverse().join('/') : props.placeholder);
function select(date: DateValue | undefined) {
  if (!date) return;
  emit('update:modelValue', date.toString());
  open.value = false;
}
</script>

<template>
  <div class="relative min-w-0">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button :id="id" v-bind="$attrs" type="button" variant="outline" class="h-10 w-full min-w-0 justify-start gap-2 px-2 text-left font-normal" :class="modelValue ? 'pr-7' : ''" :aria-invalid="invalid || undefined" :aria-label="`${placeholder}: ${modelValue ? display : 'Chưa chọn'}`">
          <CalendarDays class="size-4 shrink-0" aria-hidden="true" />
          <span class="truncate" :class="!selected ? 'text-muted-foreground' : undefined">{{ display }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent data-date-picker-calendar align="start" class="w-auto max-w-[calc(100vw-2rem)] p-0 shadow-none border border-border">
        <Calendar :model-value="selected" :min-value="minimum" locale="vi-VN" :week-starts-on="1" @update:model-value="select" />
      </PopoverContent>
    </Popover>
    <button v-if="modelValue" type="button" aria-label="Xoá ngày" class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" @click.stop="emit('update:modelValue', '')"><X class="size-3" aria-hidden="true" /></button>
  </div>
</template>
