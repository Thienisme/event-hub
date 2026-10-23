<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';
import type { AdminUser, UserRole, RoleFilter, StatusFilter } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import DataState from '../components/DataState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { formatDateTime } from '../utils/format';

const router = useRouter();
const adminStore = useAdminStore();
const authStore = useAuthStore();

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'CUSTOMER', label: 'Khách hàng' },
  { value: 'ORGANIZER', label: 'Ban tổ chức' },
  { value: 'ADMIN', label: 'Quản trị viên' },
];

const roleClass: Record<UserRole, string> = {
  CUSTOMER: 'bg-gray-100 text-gray-700 border-gray-200',
  ORGANIZER: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
};

/** Đang chờ xác nhận khoá/mở khoá. */
const pendingLock = ref<{ user: AdminUser; isActive: boolean } | null>(null);
const lockDialogBusy = ref(false);

/** Ô tìm kiếm: chỉ đồng bộ vào store sau khi ngừng gõ 400ms. */
const searchInput = ref(adminStore.search);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const handleSearchInput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    adminStore.search = searchInput.value;
    adminStore.page = 1;
    adminStore.reload();
  }, 400);
};

// Đổi bộ lọc -> về trang 1 rồi tải lại.
const applyFilter = () => {
  adminStore.page = 1;
  adminStore.reload();
};

const changePage = (page: number) => {
  if (page < 1 || page > adminStore.totalPages) return;
  adminStore.page = page;
  adminStore.reload();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const handleRoleChange = (user: AdminUser, event: Event) => {
  const role = (event.target as HTMLSelectElement).value as UserRole;
  adminStore.updateRole(user.id, role);
};

const requestToggleLock = (user: AdminUser) => {
  pendingLock.value = { user, isActive: !user.isActive };
};

const confirmToggleLock = async () => {
  if (!pendingLock.value) return;

  lockDialogBusy.value = true;
  const { user, isActive } = pendingLock.value;

  await adminStore.updateStatus(user.id, isActive);

  lockDialogBusy.value = false;
  pendingLock.value = null;
};

const isSelf = (user: AdminUser) => user.id === authStore.user?.id;

onMounted(() => {
  adminStore.reload();
});

onUnmounted(() => {
  clearTimeout(searchTimer);
  adminStore.cancelPending();
});

// Người dùng đổi tài khoản -> thông tin trong bảng không còn đúng nữa.
watch(
  () => authStore.user?.id,
  () => adminStore.reload()
);
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">Quản trị người dùng</h1>
          <p class="mt-1 text-sm text-gray-500">
            Phân quyền, khoá và mở khoá tài khoản
          </p>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            @click="router.push({ name: 'AdminAuditLogs' })"
          >
            Nhật ký
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            @click="router.push({ name: 'AdminDashboard' })"
          >
            ← Về tổng quan
          </button>
        </div>
      </div>

      <!-- Thẻ thống kê nhanh -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Tổng tài khoản</p>
          <p class="mt-1 text-2xl font-extrabold text-gray-900">
            {{ adminStore.stats?.total ?? '—' }}
          </p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Đang hoạt động</p>
          <p class="mt-1 text-2xl font-extrabold text-green-600">
            {{ adminStore.stats?.active ?? '—' }}
          </p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Bị khoá</p>
          <p class="mt-1 text-2xl font-extrabold text-red-600">
            {{ adminStore.stats?.locked ?? '—' }}
          </p>
        </div>
        <div class="bg-white border border-gray-100 rounded-xl p-4">
          <p class="text-xs text-gray-500">Quản trị viên</p>
          <p class="mt-1 text-2xl font-extrabold text-purple-600">
            {{ adminStore.stats?.byRole?.ADMIN ?? '—' }}
          </p>
        </div>
      </div>

      <!-- Bộ lọc -->
      <div class="bg-white border border-gray-100 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div class="relative flex-1">
          <input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo email hoặc tên..."
            class="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
            @input="handleSearchInput"
          />
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <select
          :value="adminStore.roleFilter"
          class="px-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          @change="adminStore.roleFilter = ($event.target as HTMLSelectElement).value as RoleFilter; applyFilter()"
        >
          <option value="ALL">Mọi vai trò</option>
          <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>

        <select
          :value="adminStore.statusFilter"
          class="px-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          @change="adminStore.statusFilter = ($event.target as HTMLSelectElement).value as StatusFilter; applyFilter()"
        >
          <option value="ALL">Mọi trạng thái</option>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="LOCKED">Đã khoá</option>
        </select>
      </div>

      <!-- Bảng -->
      <div class="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <DataState
          :loading="adminStore.loading"
          :loaded="adminStore.loaded"
          :error="adminStore.errorMessage"
          :empty="adminStore.users.length === 0"
          empty-title="Không tìm thấy tài khoản nào"
          empty-description="Thử đổi từ khoá hoặc bộ lọc khác."
          @retry="adminStore.reload()"
        >
          <template #skeleton>
            <div class="divide-y divide-gray-100">
              <div v-for="n in 6" :key="n" class="px-5 py-4 flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
                <div class="flex-1 space-y-2">
                  <div class="h-3 w-1/3 bg-gray-200 rounded animate-pulse"></div>
                  <div class="h-3 w-1/4 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div class="h-8 w-28 bg-gray-200 rounded-lg animate-pulse"></div>
              </div>
            </div>
          </template>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th class="px-5 py-3 font-semibold">Tài khoản</th>
                  <th class="px-5 py-3 font-semibold">Vai trò</th>
                  <th class="px-5 py-3 font-semibold">Trạng thái</th>
                  <th class="px-5 py-3 font-semibold">Ngày tạo</th>
                  <th class="px-5 py-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>

              <tbody class="divide-y divide-gray-100">
                <tr
                  v-for="user in adminStore.users"
                  :key="user.id"
                  class="hover:bg-gray-50/70 transition-colors"
                >
                  <td class="px-5 py-4">
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm"
                      >
                        {{ user.fullName.slice(0, 2).toUpperCase() }}
                      </div>
                      <div class="min-w-0">
                        <p class="font-medium text-gray-900 truncate">
                          {{ user.fullName }}
                          <span
                            v-if="isSelf(user)"
                            class="ml-1 text-[11px] font-normal text-indigo-600"
                          >(bạn)</span>
                        </p>
                        <p class="text-xs text-gray-500 truncate">{{ user.email }}</p>
                      </div>
                    </div>
                  </td>

                  <td class="px-5 py-4">
                    <select
                      :value="user.role"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      class="px-2.5 py-1.5 text-xs font-medium border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      :class="roleClass[user.role]"
                      :aria-label="`Vai trò của ${user.fullName}`"
                      @change="handleRoleChange(user, $event)"
                    >
                      <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                  </td>

                  <td class="px-5 py-4">
                    <span
                      class="px-2.5 py-1 text-xs font-semibold rounded-full border"
                      :class="
                        user.isActive
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      "
                    >
                      {{ user.isActive ? 'Hoạt động' : 'Đã khoá' }}
                    </span>
                  </td>

                  <td class="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                    {{ formatDateTime(user.createdAt) }}
                  </td>

                  <td class="px-5 py-4 text-right">
                    <button
                      type="button"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      class="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      :class="
                        user.isActive
                          ? 'text-red-600 border-red-200 hover:bg-red-50'
                          : 'text-green-600 border-green-200 hover:bg-green-50'
                      "
                      @click="requestToggleLock(user)"
                    >
                      <span v-if="adminStore.updatingId === user.id">...</span>
                      <span v-else>{{ user.isActive ? 'Khoá' : 'Mở khoá' }}</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      <!-- Phân trang -->
      <div
        v-if="adminStore.totalPages > 1 && adminStore.users.length > 0"
        class="flex items-center justify-between gap-3"
      >
        <p class="text-sm text-gray-500">
          Tổng <strong class="text-gray-900">{{ adminStore.total }}</strong> tài khoản
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="adminStore.page === 1"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(adminStore.page - 1)"
          >
            Trước
          </button>

          <span class="text-sm text-gray-600 px-3">
            Trang <strong class="text-gray-900">{{ adminStore.page }}</strong>
            / {{ adminStore.totalPages }}
          </span>

          <button
            type="button"
            :disabled="adminStore.page === adminStore.totalPages"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(adminStore.page + 1)"
          >
            Sau
          </button>
        </div>
      </div>
    </div>

    <!-- Hộp thoại xác nhận khoá/mở khoá -->
    <ConfirmDialog
      :open="pendingLock !== null"
      :title="pendingLock?.isActive ? 'Mở khoá tài khoản?' : 'Khoá tài khoản?'"
      :message="
        pendingLock?.isActive
          ? `Tài khoản ${pendingLock.user.fullName} sẽ đăng nhập và thao tác được trở lại.`
          : `Tài khoản ${pendingLock?.user.fullName} sẽ không đăng nhập được nữa, và các phiên đang mở sẽ mất quyền ngay.`
      "
      :confirm-label="pendingLock?.isActive ? 'Mở khoá' : 'Khoá tài khoản'"
      :danger="!pendingLock?.isActive"
      :loading="lockDialogBusy"
      @confirm="confirmToggleLock"
      @cancel="pendingLock = null"
    />
  </div>
</template>
