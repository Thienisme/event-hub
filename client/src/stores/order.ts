import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';
import type { TicketType } from './event';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

/** Vé lẻ bên trong một order (BE include tickets của order) */
export interface OrderTicket {
  id: string;
  orderId: string;
  ticketTypeId: string;
  qrCode?: string | null;
  createdAt: string;
  /** Chỉ có ở /orders/my-orders, kèm luôn event của loại vé đó */
  ticketType?: TicketType & {
    event?: {
      title: string;
      startTime: string;
      location: string;
    };
  };
}

export interface Order {
  id: string;
  userId: string;
  /** Decimal -> serialize thành chuỗi, xem ghi chú ở TicketType.price */
  totalAmount: number | string;
  status: OrderStatus;
  expiresAt?: string | null;
  createdAt: string;
  tickets: OrderTicket[];
}

/** BE trả về: { message, order } */
export interface CreateOrderResponse {
  message: string;
  order: Order;
}

/** POST /orders/:id/confirm và /orders/:id/cancel trả cùng dạng này */
export type UpdateOrderResponse = CreateOrderResponse;

export const useOrderStore = defineStore('order', () => {
  const orders = ref<Order[]>([]);
  const loading = ref(false);

  /**
   * Đặt vé. BE dùng distributed lock (Redlock) + transaction, nên có thể trả về:
   * - 201: thành công
   * - 400: hết vé / số lượng không hợp lệ / loại vé không tồn tại
   * - 401: chưa đăng nhập hoặc token hết hạn
   * - 403: token không hợp lệ
   * - 429: quá tải vì nhiều người cùng mua
   * Tất cả lỗi đều có dạng { message } bằng tiếng Việt -> hiển thị thẳng cho user.
   */
  async function createOrder(ticketTypeId: string, quantity: number): Promise<CreateOrderResponse> {
    const response = await apiClient.post<CreateOrderResponse>('/orders', {
      ticketTypeId,
      quantity,
    });
    return response.data;
  }

  /** BE trả về mảng order trực tiếp (không bọc trong { data }) */
  async function fetchMyOrders(): Promise<Order[]> {
    loading.value = true;
    try {
      const response = await apiClient.get<Order[]>('/orders/my-orders');
      orders.value = response.data;
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

  return {
    orders,
    loading,
    createOrder,
    fetchMyOrders,
    confirmOrder,
    cancelOrder,
  };
});
