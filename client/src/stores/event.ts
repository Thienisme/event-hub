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

  // Lấy danh sách sự kiện
  async function fetchEvents(params = { page: 1, limit: 10, search: '' }): Promise<EventListResponse> {
    loading.value = true;
    try {
      const response = await apiClient.get<EventListResponse>('/events', { params });
      events.value = response.data.data;
      return response.data;
    } finally {
      loading.value = false;
    }
  }

  // Lấy chi tiết 1 sự kiện
  async function fetchEventById(id: string): Promise<EventItem | null> {
    loading.value = true;
    try {
      const response = await apiClient.get<EventDetailResponse>(`/events/${id}`);
      currentEvent.value = response.data.data;
      return currentEvent.value;
    } finally {
      loading.value = false;
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
