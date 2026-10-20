import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

/**
 * Hàng đợi thông báo nổi (toast).
 *
 * Vì sao không dùng AppAlert inline cho mọi thao tác?
 * AppAlert nằm trong luồng nội dung nên khi báo lỗi nó ĐẨY layout xuống, nhảy
 * layout giữa lúc đang lướt bảng — rất khó chịu. Toast nổi ở góc màn hình,
 * không ảnh hưởng tới bố cục, và tự biến mất sau một khoảng thời gian.
 *
 * Thông báo tự động biến mất: người dùng không cần bấm gì để tiếp tục, và
 * thao tác "xác nhận" vẫn có hậu quả rõ ràng (nút trong bảng chuyển trạng thái).
 */
export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  let nextId = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function dismiss(id: number) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function push(message: string, type: ToastType = 'info', duration = 4000) {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, type, message }];

    timers.set(
      id,
      setTimeout(() => dismiss(id), duration)
    );

    return id;
  }

  const success = (message: string) => push(message, 'success');
  const error = (message: string) => push(message, 'error');
  const info = (message: string) => push(message, 'info');

  return { toasts, push, dismiss, success, error, info };
});
