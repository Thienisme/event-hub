import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';

import type { Offer } from '@/utils/offers';

export type PromoDiscountType = 'PERCENT' | 'FIXED';

/**
 * Mã giảm giá theo hợp đồng API giai đoạn 2 (mục A).
 * `discountValue` là chuỗi Decimal 12,2 (như `totalAmount` cũ) -> luôn ép số trước khi tính hay hiển thị.
 */
export interface PromoCode {
  id: string;
  eventId: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: string;
  maxUses: number | null;
  usedCount: number;
  perUserLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromoCodeInput {
  isPublic?: boolean;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  maxUses?: number | null;
  perUserLimit?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface PromoListResponse {
  message: string;
  data: PromoCode[];
}

interface PromoMutationResponse {
  message: string;
  data: PromoCode;
}

/** Store mã giảm giá của một sự kiện (cho ORGANIZER / ADMIN). */
export const usePromoStore = defineStore('promo', () => {
  const codes = ref<PromoCode[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const errorMessage = ref('');

  async function fetchEventOffers(eventId: string, signal?: AbortSignal): Promise<Offer[]> {
    const { data } = await apiClient.get<{ data: Offer[] }>(
      `/events/${encodeURIComponent(eventId)}/offers`, { signal }
    );
    return data.data;
  }

  async function list(eventId: string): Promise<void> {
    loading.value = true;
    errorMessage.value = '';

    try {
      const { data } = await apiClient.get<PromoListResponse>(
        `/events/${encodeURIComponent(eventId)}/promo-codes`
      );
      codes.value = data.data;
      loaded.value = true;
    } catch (error: any) {
      errorMessage.value =
        error.response?.data?.message || 'Không tải được danh sách mã giảm giá!';
    } finally {
      loading.value = false;
    }
  }

  /** Tạo mã mới; trả null khi lỗi (view tự bắt và hiện toast). */
  async function create(eventId: string, body: PromoCodeInput): Promise<PromoCode | null> {
    const { data } = await apiClient.post<PromoMutationResponse>(
      `/events/${encodeURIComponent(eventId)}/promo-codes`,
      body
    );
    codes.value = [data.data, ...codes.value];
    return data.data;
  }

  /** Cập nhật một phần (vd `active`); trả null khi lỗi. */
  async function update(
    id: string,
    body: Partial<PromoCodeInput> & { active?: boolean }
  ): Promise<PromoCode | null> {
    const { data } = await apiClient.patch<PromoMutationResponse>(`/promo-codes/${id}`, body);
    codes.value = codes.value.map((code) => (code.id === id ? data.data : code));
    return data.data;
  }

  /** Xoá mã (server trả 409 nếu mã đã được dùng). */
  async function remove(id: string): Promise<void> {
    await apiClient.delete(`/promo-codes/${id}`);
    codes.value = codes.value.filter((code) => code.id !== id);
  }

  /** Xoá sạch state (dùng khi sang sự kiện khác, tránh hiện dữ liệu cũ). */
  function reset(): void {
    codes.value = [];
    loaded.value = false;
    errorMessage.value = '';
  }

  return { codes, loading, loaded, errorMessage, fetchEventOffers, list, create, update, remove, reset };
});
