import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';

/**
 * Danh sách chờ vé (waitlist).
 *
 * BE lưu trạng thái theo (ticketTypeId, userId) nên client chỉ cần biết:
 * với mỗi sự kiện, user đang chờ những loại vé nào (chưa được báo).
 * Kết quả chia nhóm theo eventId để đổi sự kiện không lẫn dữ liệu.
 */
export const useWaitlistStore = defineStore('waitlist', () => {
  /** eventId -> các ticketTypeId đang chờ (chưa được báo) */
  const waitingByEvent = ref<Record<string, string[]>>({});
  /** Đánh dấu đã tải trạng thái của sự kiện để không gọi lại vô ích */
  const loadedEvents = ref<Record<string, boolean>>({});

  /**
   * GET /events/:id/waitlist/me (cần đăng nhập): các loại vé user đang chờ
   * của một sự kiện. Trả rỗng nếu chưa đăng ký loại nào.
   */
  async function load(eventId: string): Promise<void> {
    if (loadedEvents.value[eventId]) return;

    const response = await apiClient.get<{ data: { ticketTypeIds: string[] } }>(
      `/events/${eventId}/waitlist/me`
    );
    waitingByEvent.value[eventId] = response.data.data?.ticketTypeIds ?? [];
    loadedEvents.value[eventId] = true;
  }

  /**
   * POST /ticket-types/:id/waitlist: đứng vào hàng chờ.
   * 409 nếu loại vé vẫn còn -> message BE đưa thẳng cho user.
   * Đăng ký lại sau khi đã được báo thì BE đưa về cuối hàng.
   */
  async function join(eventId: string, ticketTypeId: string): Promise<{ message?: string }> {
    const response = await apiClient.post<{ message: string }>(
      `/ticket-types/${ticketTypeId}/waitlist`
    );

    const list = waitingByEvent.value[eventId] ?? [];
    if (!list.includes(ticketTypeId)) {
      waitingByEvent.value[eventId] = [...list, ticketTypeId];
    }

    return response.data;
  }

  /**
   * DELETE /ticket-types/:id/waitlist: rời hàng chờ. BE trả 200 cả khi
   * user chưa đăng ký, nên cập nhật state địa phương là đủ.
   */
  async function leave(eventId: string, ticketTypeId: string): Promise<{ message?: string }> {
    const response = await apiClient.delete<{ message: string }>(
      `/ticket-types/${ticketTypeId}/waitlist`
    );

    waitingByEvent.value[eventId] = (waitingByEvent.value[eventId] ?? []).filter(
      (id) => id !== ticketTypeId
    );

    return response.data;
  }

  /** User có đang chờ loại vé này không (theo eventId đang xem). */
  function isWaiting(eventId: string, ticketTypeId: string): boolean {
    return (waitingByEvent.value[eventId] ?? []).includes(ticketTypeId);
  }

  /** Đổi tài khoản (đăng xuất/đăng nhập user khác) -> bỏ cache trạng thái cũ. */
  function reset(): void {
    waitingByEvent.value = {};
    loadedEvents.value = {};
  }

  return { waitingByEvent, loadedEvents, load, join, leave, isWaiting, reset };
});
