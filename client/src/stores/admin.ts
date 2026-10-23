import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../api/axios';
import { useToastStore } from './toast';

export type UserRole = 'CUSTOMER' | 'ORGANIZER' | 'ADMIN';
export type RoleFilter = 'ALL' | UserRole;
export type StatusFilter = 'ALL' | 'ACTIVE' | 'LOCKED';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserListResponse {
  message: string;
  data: AdminUser[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  stats: {
    total: number;
    active: number;
    locked: number;
    byRole: Record<string, number>;
  };
}

/**
 * Một dòng nhật ký quản trị.
 *
 * `actor` có thể null: nếu tài khoản admin bị xoá sau đó thì khoá ngoại được
 * đặt thành NULL (ON DELETE SET NULL) để nhật ký không bị mất. Vì vậy `actorEmail`
 * là bản chụp lúc ghi — luôn có, và là nguồn hiển thị chính.
 */
export interface AdminAuditLog {
  id: string;
  action: string;
  targetId: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
  actorEmail: string;
  actor: { id: string; fullName: string; email: string } | null;
}

interface AuditLogResponse {
  message: string;
  data: AdminAuditLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Store quản trị người dùng.
 *
 * Filter/trang được giữ trong STORE chứ không phải local state của view: rời
 * trang rồi quay lại thì bộ lọc còn nguyên, không phải gõ lại từ đầu.
 */
export const useAdminStore = defineStore('admin', () => {
  const toastStore = useToastStore();

  const users = ref<AdminUser[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const errorMessage = ref('');

  const page = ref(1);
  const limit = ref(20);
  const totalPages = ref(1);
  const total = ref(0);

  const search = ref('');
  const roleFilter = ref<RoleFilter>('ALL');
  const statusFilter = ref<StatusFilter>('ALL');

  const stats = ref<UserListResponse['stats'] | null>(null);

  // ---- Nhật ký quản trị ----
  const auditLogs = ref<AdminAuditLog[]>([]);
  const auditLoading = ref(false);
  const auditLoaded = ref(false);
  const auditErrorMessage = ref('');
  const auditPage = ref(1);
  const auditLimit = ref(20);
  const auditTotalPages = ref(1);
  const auditTotal = ref(0);

  /** Id của dòng đang được thao tác -> chỉ disable nút của đúng dòng đó. */
  const updatingId = ref<string | null>(null);

  // Số request đang bay, để request cũ bị huỷ không tắt loading của request mới.
  let activeRequests = 0;
  const beginRequest = () => {
    activeRequests += 1;
    loading.value = true;
  };
  const endRequest = () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) loading.value = false;
  };

  /** Controller của request đang bay để huỷ khi có request mới. */
  let inFlight: AbortController | undefined;
  /** Controller riêng cho nhật ký, tách khỏi nhau để huỷ không ảnh hưởng. */
  let auditInFlight: AbortController | undefined;

  async function fetchUsers(signal?: AbortSignal): Promise<void> {
    beginRequest();
    errorMessage.value = '';

    try {
      const { data } = await apiClient.get<UserListResponse>('/admin/users', {
        params: {
          page: page.value,
          limit: limit.value,
          search: search.value.trim(),
          role: roleFilter.value,
          status: statusFilter.value,
        },
        signal,
      });

      users.value = data.data;
      totalPages.value = data.pagination.totalPages;
      total.value = data.pagination.total;
      stats.value = data.stats;
    } catch (error: any) {
      // Request bị chính mình huỷ -> không phải lỗi.
      if (error?.code === 'ERR_CANCELED') return;
      errorMessage.value =
        error.response?.data?.message || 'Không tải được danh sách người dùng!';
    } finally {
      endRequest();
      loaded.value = true;
    }
  }

  /** Tải danh sách, huỷ request cũ (tránh response về muộn ghi đè). */
  async function reload(): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    await fetchUsers(controller.signal);
  }

  function cancelPending(): void {
    inFlight?.abort();
  }

  /** Tải trang nhật ký quản trị. */
  async function fetchAuditLogs(signal?: AbortSignal): Promise<void> {
    auditLoading.value = true;
    auditErrorMessage.value = '';

    try {
      const { data } = await apiClient.get<AuditLogResponse>('/admin/audit-logs', {
        params: { page: auditPage.value, limit: auditLimit.value },
        signal,
      });

      auditLogs.value = data.data;
      auditTotalPages.value = data.pagination.totalPages;
      auditTotal.value = data.pagination.total;
    } catch (error: any) {
      if (error?.code === 'ERR_CANCELED') return;
      auditErrorMessage.value =
        error.response?.data?.message || 'Không tải được nhật ký quản trị!';
    } finally {
      auditLoading.value = false;
      auditLoaded.value = true;
    }
  }

  async function reloadAuditLogs(): Promise<void> {
    auditInFlight?.abort();
    const controller = new AbortController();
    auditInFlight = controller;
    await fetchAuditLogs(controller.signal);
  }

  function cancelAuditPending(): void {
    auditInFlight?.abort();
  }

  /**
   * Đổi vai trò — cập nhật ngay trên UI (optimistic) rồi rollback nếu API lỗi.
   *
   * Vì sao optimistic: thao tác này là một dropdown, đợi round-trip để đổi nhãn
   * khiến người dùng tưởng như bị treo. Rollback + toast làm cho trạng thái luôn
   * khớp với server.
   */
  async function updateRole(id: string, role: UserRole): Promise<boolean> {
    const target = users.value.find((user) => user.id === id);
    if (!target || target.role === role) return true;

    const previousRole = target.role;
    target.role = role;
    updatingId.value = id;

    try {
      const { data } = await apiClient.patch<{ message: string; data: AdminUser }>(
        `/admin/users/${id}/role`,
        { role }
      );

      Object.assign(target, data.data);
      toastStore.success(data.message);
      return true;
    } catch (error: any) {
      target.role = previousRole;
      toastStore.error(
        error.response?.data?.message || 'Cập nhật vai trò thất bại!'
      );
      return false;
    } finally {
      updatingId.value = null;
    }
  }

  /** Khoá / mở khoá tài khoản — cũng optimistic + rollback. */
  async function updateStatus(id: string, isActive: boolean): Promise<boolean> {
    const target = users.value.find((user) => user.id === id);
    if (!target) return false;

    const previous = target.isActive;
    target.isActive = isActive;
    updatingId.value = id;

    try {
      const { data } = await apiClient.patch<{ message: string; data: AdminUser }>(
        `/admin/users/${id}/status`,
        { isActive }
      );

      Object.assign(target, data.data);
      toastStore.success(data.message);
      return true;
    } catch (error: any) {
      target.isActive = previous;
      toastStore.error(
        error.response?.data?.message || 'Cập nhật trạng thái tài khoản thất bại!'
      );
      return false;
    } finally {
      updatingId.value = null;
    }
  }

  return {
    users,
    loading,
    loaded,
    errorMessage,
    page,
    limit,
    totalPages,
    total,
    search,
    roleFilter,
    statusFilter,
    stats,
    updatingId,
    auditLogs,
    auditLoading,
    auditLoaded,
    auditErrorMessage,
    auditPage,
    auditLimit,
    auditTotalPages,
    auditTotal,
    fetchUsers,
    reload,
    cancelPending,
    updateRole,
    updateStatus,
    fetchAuditLogs,
    reloadAuditLogs,
    cancelAuditPending,
  };
});
