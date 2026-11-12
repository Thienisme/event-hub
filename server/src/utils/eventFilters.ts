import { EventCategory } from '@prisma/client';

export interface EventFilters {
  category?: EventCategory;
  location?: string;
  from?: Date;
  to?: Date;
  minPrice?: number;
  maxPrice?: number;
}

/** Chỉ nhận ngày lịch hợp lệ; ngày không có giờ được hiểu theo giờ Việt Nam. */
function parseDate(value: unknown, endOfDay: boolean): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== text.slice(0, 10)) return undefined;
  const date = new Date(text.length === 10
    ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`
    : text);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return undefined;
  const price = Number(value.trim());
  return Number.isFinite(price) ? Math.min(price, 9_999_999_999) : undefined;
}

/** Bỏ qua tham số sai thay vì làm lỗi API danh sách công khai. */
export function parseEventFilters(query: Record<string, unknown>): EventFilters {
  const category = typeof query.category === 'string' && Object.values(EventCategory).includes(query.category as EventCategory)
    ? query.category as EventCategory : undefined;
  const location = typeof query.location === 'string' ? query.location.trim().slice(0, 100) || undefined : undefined;
  let from = parseDate(query.from, false);
  let to = parseDate(query.to, true);
  if (from && to && from > to) { from = undefined; to = undefined; }
  let minPrice = parsePrice(query.minPrice);
  let maxPrice = parsePrice(query.maxPrice);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return { category, location, from, to, minPrice, maxPrice };
}
