import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';

export interface ManagedTicketType {
  id: string;
  name: string;
  price: number | string;
  totalQuantity: number;
  availableQuantity: number;
}

export interface ManagedEvent {
  id: string;
  title: string;
  location: string;
  startTime: string;
  endTime: string;
  createdAt: string;
  ticketTypes: ManagedTicketType[];
  organizer?: { id: string; fullName: string; email: string };
}

export interface OrganizerStats {
  events: number;
  upcomingEvents: number;
  totalTickets: number;
  soldTickets: number;
  confirmedOrders: number;
  revenue: number | string;
}

interface MyEventsResponse {
  message: string;
  data: ManagedEvent[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Store "sự kiện của tôi" (cho ORGANIZER / ADMIN).
 *
 * Tách riêng khỏi store event của trang công khai vì:
 * - dữ liệu khác nhau (có thống kê bán hàng, lọc theo chính mình);
 * - store công khai bị ghi đè bởi mọi lần xem trang chi tiết sự kiện.
 */
export const useManageStore = defineStore('manage', () => {
  const events = ref<ManagedEvent[]>([]);
  const stats = ref<OrganizerStats | null>(null);

  const loading = ref(false);
  const loaded = ref(false);
  const errorMessage = ref('');

  const page = ref(1);
  const limit = ref(20);
  const totalPages = ref(1);
  const total = ref(0);
  const search = ref('');

  let activeRequests = 0;
  const beginRequest = () => {
    activeRequests += 1;
    loading.value = true;
  };
  const endRequest = () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) loading.value = false;
  };

  let inFlight: AbortController | undefined;

  async function fetchMyEvents(signal?: AbortSignal): Promise<void> {
    beginRequest();
    errorMessage.value = '';

    try {
      const { data } = await apiClient.get<MyEventsResponse>('/organizer/events', {
        params: {
          page: page.value,
          limit: limit.value,
          search: search.value.trim(),
        },
        signal,
      });

      events.value = data.data;
      totalPages.value = data.pagination.totalPages;
      total.value = data.pagination.total;
    } catch (error: any) {
      if (error?.code === 'ERR_CANCELED') return;
      errorMessage.value =
        error.response?.data?.message || 'Không tải được danh sách sự kiện của bạn!';
    } finally {
      endRequest();
      loaded.value = true;
    }
  }

  async function fetchStats(): Promise<void> {
    try {
      const { data } = await apiClient.get<{ data: OrganizerStats }>('/organizer/stats');
      stats.value = data.data;
    } catch {
      // Thống kê là phần phụ: lỗi thì để trống cũng được, không chặn cả trang.
      stats.value = null;
    }
  }

  async function reload(): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    await Promise.all([fetchMyEvents(controller.signal), fetchStats()]);
  }

  function cancelPending(): void {
    inFlight?.abort();
  }

  /** Xoá một sự kiện khỏi danh sách (dùng sau khi API xoá thành công). */
  function removeEvent(id: string): void {
    events.value = events.value.filter((event) => event.id !== id);
    total.value = Math.max(0, total.value - 1);
  }

  return {
    events,
    stats,
    loading,
    loaded,
    errorMessage,
    page,
    limit,
    totalPages,
    total,
    search,
    fetchMyEvents,
    fetchStats,
    reload,
    cancelPending,
    removeEvent,
  };
});
