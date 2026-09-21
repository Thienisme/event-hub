import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';

export interface EventOrganizer {
  id: string;
  fullName: string;
  email: string;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  /**
   * Prisma dùng kiểu Decimal -> khi serialize sang JSON sẽ thành CHUỖI (vd "150000"),
   * không phải number. Luôn bọc Number() trước khi tính toán / format.
   */
  price: number | string;
  totalQuantity: number;
  availableQuantity: number;
}

export interface EventItem {
  id: string;
  title: string;
  description?: string | null;
  location: string;
  bannerUrl?: string | null;
  startTime: string;
  endTime: string;
  organizerId: string;
  organizer?: EventOrganizer;
  ticketTypes?: TicketType[];
}

export interface EventListResponse {
  source?: string;
  data: EventItem[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/** BE trả về: { source, data: event } */
interface EventDetailResponse {
  source?: string;
  data: EventItem;
}

export const useEventStore = defineStore('event', () => {
  const events = ref<EventItem[]>([]);
  const currentEvent = ref<EventItem | null>(null);
  const loading = ref(false);

  // Đếm số request đang bay. Nếu chỉ bật/tắt loading theo từng request,
  // khi request cũ bị huỷ (abort) nó sẽ tắt loading trong khi request mới
  // vẫn đang chạy -> skeleton biến mất sớm, UI nháy "không có dữ liệu".
  let activeRequests = 0;
  const beginRequest = () => {
    activeRequests += 1;
    loading.value = true;
  };
  const endRequest = () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) loading.value = false;
  };

  // Lấy danh sách sự kiện.
  // `signal` (tuỳ chọn) cho phép view huỷ request cũ khi user gõ tiếp / đổi trang,
  // tránh response về muộn ghi đè kết quả mới (race condition).
  async function fetchEvents(
    params = { page: 1, limit: 10, search: '' },
    signal?: AbortSignal
  ): Promise<EventListResponse> {
    beginRequest();
    try {
      const response = await apiClient.get<EventListResponse>('/events', { params, signal });
      events.value = response.data.data;
      return response.data;
    } finally {
      endRequest();
    }
  }

  // Lấy chi tiết 1 sự kiện (kèm `signal` để huỷ khi đổi route nhanh)
  async function fetchEventById(id: string, signal?: AbortSignal): Promise<EventItem | null> {
    beginRequest();
    try {
      const response = await apiClient.get<EventDetailResponse>(`/events/${id}`, { signal });
      currentEvent.value = response.data.data;
      return currentEvent.value;
    } finally {
      endRequest();
    }
  }

  return {
    events,
    currentEvent,
    loading,
    fetchEvents,
    fetchEventById,
  };
});
