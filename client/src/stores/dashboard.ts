import { ref } from 'vue';
import { defineStore } from 'pinia';
import apiClient from '@/api/axios';
import type { EventCategory } from '@/utils/categories';

export type DashboardRange = 7 | 30 | 90;
export const DASHBOARD_RANGES: DashboardRange[] = [7, 30, 90];

export interface DailySales {
  /** YYYY-MM-DD theo giờ Việt Nam. */
  date: string;
  revenue: number;
  orders: number;
  tickets: number;
}

export interface PeriodTotals {
  revenue: number;
  orders: number;
  tickets: number;
}

export interface PeriodComparison {
  current: PeriodTotals;
  previous: PeriodTotals;
}

export interface CategorySales {
  category: EventCategory;
  revenue: number;
  tickets: number;
}

export interface TicketTypeSales {
  id: string;
  name: string;
  eventId: string;
  eventTitle: string;
  category: EventCategory;
  price: number;
  total: number;
  sold: number;
  checkedIn: number;
  revenue: number;
}

export interface EventCheckIn {
  id: string;
  title: string;
  category: EventCategory;
  startTime: string;
  endTime: string;
  sold: number;
  checkedIn: number;
}

export interface SalesDashboard {
  eventId: string | null;
  range: { days: number; from: string; to: string };
  events: Array<{ id: string; title: string; category: EventCategory; startTime: string }>;
  /** Toàn thời gian trong phạm vi sự kiện đang chọn, chỉ đơn đã thanh toán. */
  summary: { revenue: number; discount: number; orders: number; ticketsSold: number; capacity: number; checkedIn: number };
  period: PeriodComparison;
  daily: DailySales[];
  ticketTypes: TicketTypeSales[];
  byCategory: CategorySales[];
  eventsCheckIn: EventCheckIn[];
}

export const useDashboardStore = defineStore('dashboard', () => {
  const data = ref<SalesDashboard | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const errorMessage = ref('');
  let controller: AbortController | null = null;

  async function fetchDashboard(params: { eventId: string | null; days: DashboardRange }) {
    // Đổi bộ lọc liên tục: huỷ request cũ để kết quả cũ không đè kết quả mới.
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = true;
    errorMessage.value = '';
    try {
      const response = await apiClient.get<{ data: SalesDashboard }>('/organizer/dashboard', {
        params: { days: params.days, ...(params.eventId ? { eventId: params.eventId } : {}) },
        signal: current.signal,
      });
      data.value = response.data.data;
    } catch (error: any) {
      if (current.signal.aborted) return;
      errorMessage.value = error?.response?.data?.message || 'Không tải được bảng điều khiển. Vui lòng thử lại.';
    } finally {
      if (!current.signal.aborted) {
        loading.value = false;
        loaded.value = true;
      }
    }
  }

  return { data, loading, loaded, errorMessage, fetchDashboard };
});
