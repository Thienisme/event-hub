import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';
import type { Offer } from '@/utils/offers';
import type { TicketType } from './event';

export interface OrderOffer extends Offer {
  discountAmount: string;
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

/** Vé lẻ bên trong một order (BE include tickets của order) */
export interface OrderTicket {
  id: string;
  orderId: string;
  ticketTypeId: string;
  qrCode?: string | null;
  checkedInAt?: string | null;
  createdAt: string;
  /** Có ở API đọc đơn, kèm luôn event của loại vé đó */
  ticketType?: TicketType & {
    event?: {
      title: string;
      startTime: string;
      location: string;
      bannerUrl?: string | null;
      slug?: string;
      endTime?: string;
      category?: string;
    };
  };
}

export interface Order {
  id: string;
  userId: string;
  /** Decimal -> serialize thành chuỗi, xem ghi chú ở TicketType.price */
  totalAmount: number | string;
  /** Giá trước giảm (Decimal -> chuỗi) */
  subtotalAmount?: number | string;
  /** Mức giảm (Decimal -> chuỗi), mặc định 0 */
  discountAmount?: number | string;
  promoCodeId?: string | null;
  promoCode?: string | null;
  paymentStarted?: boolean;
  status: OrderStatus;
  expiresAt?: string | null;
  createdAt: string;
  tickets: OrderTicket[];
}

/** Các cổng thanh toán BE đang bật (GET /payments/providers) */
export type PaymentProvider = 'MOCK' | 'VNPAY' | 'MOMO';

/** POST /orders/:id/pay trả về */
export interface PayOrderResponse {
  message: string;
  /** Đơn 0đ: BE xác nhận luôn và trả `order` thay vì `paymentUrl` */
  data: {
    paymentUrl?: string;
    order?: Order;
  };
}

/** POST /orders trả về: { message, order } */
export interface CreateOrderResponse {
  message: string;
  order: Order;
}

/** POST /orders/:id/confirm và /orders/:id/cancel trả cùng dạng này */
export type UpdateOrderResponse = CreateOrderResponse;

export interface OrderPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** GET /orders/my-orders: cùng dạng phân trang với danh sách sự kiện của admin */
export interface OrderListResponse {
  message: string;
  data: Order[];
  pagination: OrderPagination;
}

export const useOrderStore = defineStore('order', () => {
  const orders = ref<Order[]>([]);
  const pagination = ref<OrderPagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const loading = ref(false);

  /** Cổng thanh toán đang bật từ GET /payments/providers */
  const paymentProviders = ref<PaymentProvider[]>([]);

  /**
   * Đặt vé. BE dùng distributed lock (Redlock) + transaction, nên có thể trả về:
   * - 201: thành công
   * - 400: hết vé / số lượng không hợp lệ / loại vé không tồn tại / mã giảm giá sai
   * - 401: chưa đăng nhập hoặc token hết hạn
   * - 403: token không hợp lệ
   * - 429: quá tải vì nhiều người cùng mua
   * Tất cả lỗi đều có dạng { message } bằng tiếng Việt -> hiển thị thẳng cho user.
   */
  async function createOrder(ticketTypeId: string, quantity: number): Promise<CreateOrderResponse> {
    const response = await apiClient.post<CreateOrderResponse>('/orders', { ticketTypeId, quantity });
    return response.data;
  }

  /** Chỉ hiển thị các cổng thực sự được server bật. */
  async function loadPaymentProviders(): Promise<PaymentProvider[]> {
    const response = await apiClient.get<{ data: PaymentProvider[] }>('/payments/providers');
    paymentProviders.value = response.data.data;
    return paymentProviders.value;
  }

  async function fetchOrder(id: string): Promise<Order> {
    const response = await apiClient.get<{ message: string; data: Order }>(`/orders/${id}`);
    replaceOrder(response.data.data);
    return response.data.data;
  }

  async function fetchOrderOffers(id: string): Promise<OrderOffer[]> {
    const { data } = await apiClient.get<{ data: OrderOffer[] }>(`/orders/${encodeURIComponent(id)}/offers`);
    return data.data;
  }

  async function applyPromo(id: string, code: string): Promise<Order> {
    const response = await apiClient.post<{ message: string; data: Order }>(`/orders/${id}/promo`, { code });
    replaceOrder(response.data.data);
    return response.data.data;
  }

  async function removePromo(id: string): Promise<Order> {
    const response = await apiClient.delete<{ message: string; data: Order }>(`/orders/${id}/promo`);
    replaceOrder(response.data.data);
    return response.data.data;
  }

  /** BE trả về { message, data, pagination }, mặc định 20 đơn mỗi trang */
  async function fetchMyOrders(page = 1, limit = 20): Promise<OrderListResponse> {
    loading.value = true;
    try {
      const response = await apiClient.get<OrderListResponse>('/orders/my-orders', {
        params: { page, limit },
      });
      orders.value = response.data.data;
      pagination.value = response.data.pagination;
      return response.data;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Thay một đơn trong state bằng dữ liệu mới, giữ lại thông tin loại vé/sự kiện.
   *
   * /confirm và /cancel chỉ include `tickets` trần, nên mỗi ticket trả về KHÔNG
   * có `ticketType.event` (khác /orders/my-orders). Gán đè nguyên object sẽ làm
   * dòng vé mất tên loại vé và tên sự kiện cho tới khi F5. Ticket id không đổi
   * khi thanh toán/huỷ, nên ghép lại theo id là đủ.
   */
  function replaceOrder(updated: Order): void {
    const index = orders.value.findIndex((order) => order.id === updated.id);

    if (index === -1) {
      orders.value = [updated, ...orders.value];
      return;
    }

    const previousTickets = new Map(
      orders.value[index].tickets.map((ticket) => [ticket.id, ticket])
    );

    const merged: Order = {
      ...updated,
      tickets: updated.tickets.map((ticket) => ({
        ...ticket,
        ticketType: ticket.ticketType ?? previousTickets.get(ticket.id)?.ticketType,
      })),
    };

    orders.value = orders.value.map((order, i) => (i === index ? merged : order));
  }

  /**
   * Thanh toán giả lập: BE sinh qrCode cho từng vé và trả đơn đã CONFIRMED.
   * Gọi lại khi đơn đã CONFIRMED vẫn 200, nên bấm lại không phải lỗi.
   */
  async function confirmOrder(id: string): Promise<UpdateOrderResponse> {
    const response = await apiClient.post<UpdateOrderResponse>(`/orders/${id}/confirm`);
    replaceOrder(response.data.order);
    return response.data;
  }

  /** Huỷ đơn PENDING, BE trả vé về kho và trả đơn đã CANCELLED. */
  async function cancelOrder(id: string): Promise<UpdateOrderResponse> {
    const response = await apiClient.post<UpdateOrderResponse>(`/orders/${id}/cancel`);
    replaceOrder(response.data.order);
    return response.data;
  }

  /**
   * Bắt đầu thanh toán qua VNPay/MoMo. BE trả `paymentUrl` -> view chuyển trang
   * bằng window.location.href. Đơn tổng 0đ BE xác nhận luôn và trả `order`,
   * cập nhật tại chỗ như sau khi confirm.
   */
  async function payOrder(id: string, provider: 'VNPAY' | 'MOMO'): Promise<PayOrderResponse> {
    const response = await apiClient.post<PayOrderResponse>(`/orders/${id}/pay`, { provider });

    const order = response.data.data?.order;
    if (order) replaceOrder(order);

    return response.data;
  }

  return {
    orders,
    pagination,
    loading,
    paymentProviders,
    createOrder,
    fetchMyOrders,
    fetchOrder,
    fetchOrderOffers,
    applyPromo,
    removePromo,
    confirmOrder,
    cancelOrder,
    loadPaymentProviders,
    payOrder,
  };
});
