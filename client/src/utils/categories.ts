export const EVENT_CATEGORIES = [
  { value: 'MUSIC', label: 'Âm nhạc' },
  { value: 'SPORTS', label: 'Thể thao' },
  { value: 'CONFERENCE', label: 'Hội thảo' },
  { value: 'WORKSHOP', label: 'Workshop' },
  { value: 'THEATER', label: 'Sân khấu' },
  { value: 'EXHIBITION', label: 'Triển lãm' },
  { value: 'FESTIVAL', label: 'Lễ hội' },
  { value: 'FOOD', label: 'Ẩm thực' },
  { value: 'OTHER', label: 'Khác' },
] as const;

export type EventCategory = typeof EVENT_CATEGORIES[number]['value'];

export function categoryLabel(value: string): string {
  return EVENT_CATEGORIES.find(category => category.value === value)?.label ?? 'Khác';
}
