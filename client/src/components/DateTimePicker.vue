<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarDate, parseDate } from '@internationalized/date';
import type { DateValue } from 'reka-ui';
import { CalendarDays } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  minDate?: string;
  disabled?: boolean;
  invalid?: boolean;
}>(), { placeholder: 'Chọn ngày giờ' });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
const pad = (value: number) => String(value).padStart(2, '0');
const selectedDate = computed(() => props.modelValue ? parseDate(props.modelValue.slice(0, 10)) : undefined);
const minimum = computed(() => props.minDate ? parseDate(props.minDate.slice(0, 10)) : undefined);
const hour = computed(() => props.modelValue.slice(11, 13) || '19');
const minute = computed(() => props.modelValue.slice(14, 16) || '00');
const hours = Array.from({ length: 24 }, (_, index) => pad(index));
const minutes = computed(() => [...new Set([...Array.from({ length: 12 }, (_, index) => pad(index * 5)), minute.value])].sort());
const display = computed(() => {
  const date = selectedDate.value;
  return date ? `${pad(date.day)}/${pad(date.month)}/${date.year} · ${hour.value}:${minute.value}` : props.placeholder;
});

function update(date: DateValue | undefined, nextHour = hour.value, nextMinute = minute.value) {
  if (!date || props.disabled) return;
  const day = new CalendarDate(date.year, date.month, date.day);
  if (minimum.value && day.compare(minimum.value) < 0) return;
  emit('update:modelValue', `${day.toString()}T${nextHour}:${nextMinute}`);
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button v-bind="$attrs" type="button" variant="outline" class="w-full justify-start text-left font-normal" :disabled="disabled" :aria-invalid="invalid || undefined" :aria-label="`${placeholder}: ${modelValue ? display : 'Chưa chọn'}`">
        <CalendarDays aria-hidden="true" />
        <span :class="!modelValue ? 'text-muted-foreground' : undefined">{{ display }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-auto p-0">
      <Calendar :model-value="selectedDate" :min-value="minimum" :disabled="disabled" locale="vi-VN" :week-starts-on="1" @update:model-value="update($event)" />
      <div class="flex items-center gap-2 border-t p-3">
        <NativeSelect :model-value="hour" :disabled="disabled || !selectedDate" aria-label="Chọn giờ" @update:model-value="update(selectedDate, String($event), minute)">
          <NativeSelectOption v-for="value in hours" :key="value" :value="value">{{ value }}</NativeSelectOption>
        </NativeSelect>
        <span aria-hidden="true">:</span>
        <NativeSelect :model-value="minute" :disabled="disabled || !selectedDate" aria-label="Chọn phút" @update:model-value="update(selectedDate, hour, String($event))">
          <NativeSelectOption v-for="value in minutes" :key="value" :value="value">{{ value }}</NativeSelectOption>
        </NativeSelect>
        <Button type="button" class="ml-auto" @click="open = false">Xong</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
