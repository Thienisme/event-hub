import { ref } from 'vue';
import { defineStore } from 'pinia';
import apiClient from '@/api/axios';

/** Một nhân viên soát vé của sự kiện (góc nhìn nhà tổ chức). */
export interface EventStaffMember {
  userId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  addedAt: string;
  checkedInCount: number;
}

/** Sự kiện mà tài khoản hiện tại được gán soát vé. */
export interface CheckInEvent {
  id: string;
  title: string;
  location: string;
  startTime: string;
  endTime: string;
  bannerUrl: string | null;
  organizerName: string;
}

const errorOf = (error: any, fallback: string): string => error?.response?.data?.message || fallback;

export const useStaffStore = defineStore('staff', () => {
  // Danh sách nhân viên của sự kiện đang mở trang quản lý.
  const eventTitle = ref('');
  const maxStaff = ref(20);
  const staff = ref<EventStaffMember[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const errorMessage = ref('');

  // Sự kiện mình được gán soát vé.
  const myEvents = ref<CheckInEvent[]>([]);
  const myLoading = ref(false);
  const myLoaded = ref(false);
  const myError = ref('');

  async function fetchStaff(eventId: string) {
    loading.value = true;
    errorMessage.value = '';
    try {
      const { data } = await apiClient.get(`/events/${encodeURIComponent(eventId)}/staff`);
      eventTitle.value = data.data.eventTitle;
      maxStaff.value = data.data.maxStaff;
      staff.value = data.data.staff;
    } catch (error) {
      errorMessage.value = errorOf(error, 'Không tải được danh sách nhân viên.');
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  /** Ném lỗi để form hiện message của server. */
  async function addStaff(eventId: string, email: string): Promise<EventStaffMember> {
    const { data } = await apiClient.post(`/events/${encodeURIComponent(eventId)}/staff`, { email });
    staff.value = [...staff.value, data.data];
    return data.data;
  }

  async function removeStaff(eventId: string, userId: string) {
    await apiClient.delete(`/events/${encodeURIComponent(eventId)}/staff/${encodeURIComponent(userId)}`);
    staff.value = staff.value.filter((member) => member.userId !== userId);
  }

  async function fetchMyEvents() {
    myLoading.value = true;
    myError.value = '';
    try {
      const { data } = await apiClient.get('/check-in/events');
      myEvents.value = data.data;
    } catch (error) {
      myError.value = errorOf(error, 'Không tải được danh sách sự kiện cần soát vé.');
    } finally {
      myLoading.value = false;
      myLoaded.value = true;
    }
  }

  function reset() {
    eventTitle.value = '';
    staff.value = [];
    loaded.value = false;
    errorMessage.value = '';
  }

  return {
    eventTitle, maxStaff, staff, loading, loaded, errorMessage,
    myEvents, myLoading, myLoaded, myError,
    fetchStaff, addStaff, removeStaff, fetchMyEvents, reset,
  };
});
