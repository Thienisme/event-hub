<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ArrowLeft, ScrollText, Search } from '@lucide/vue';

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

const roleVariant = { CUSTOMER: 'secondary', ORGANIZER: 'info', ADMIN: 'default' } as const;

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
  <div class="min-h-screen bg-surface py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Đầu trang -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold text-foreground tracking-tight">Quản trị người dùng</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Phân quyền, khoá và mở khoá tài khoản
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            @click="router.push({ name: 'AdminAuditLogs' })"
           variant="outline" size="sm">
            <ScrollText class="size-4" aria-hidden="true" /> Nhật ký
          </Button>
          <Button
            type="button"
            @click="router.push({ name: 'AdminDashboard' })"
           variant="outline" size="sm">
            <ArrowLeft class="size-4" aria-hidden="true" /> Về tổng quan
          </Button>
        </div>
      </div>

      <!-- Thẻ thống kê nhanh -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-4">
          <p class="text-xs text-muted-foreground">Tổng tài khoản</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-foreground">
            {{ adminStore.stats?.total ?? '—' }}
          </p>
        </Card>
        <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-4">
          <p class="text-xs text-muted-foreground">Đang hoạt động</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-success">
            {{ adminStore.stats?.active ?? '—' }}
          </p>
        </Card>
        <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-4">
          <p class="text-xs text-muted-foreground">Bị khoá</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-danger">
            {{ adminStore.stats?.locked ?? '—' }}
          </p>
        </Card>
        <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-4">
          <p class="text-xs text-muted-foreground">Quản trị viên</p>
          <p class="mt-1 break-words text-xl sm:text-2xl font-semibold tabular-nums text-primary">
            {{ adminStore.stats?.byRole?.ADMIN ?? '—' }}
          </p>
        </Card>
      </div>

      <!-- Bộ lọc -->
      <Card class="bg-card border border-border rounded-2xl gap-0 shadow-sm p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div class="relative flex-1">
          <Input
            v-model="searchInput"
            type="text"
            placeholder="Tìm theo email hoặc tên..."
            class="w-full pl-10" aria-label="Tìm kiếm"
            @input="handleSearchInput"
          />
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search class="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>

        <NativeSelect
          :model-value="adminStore.roleFilter" aria-label="Lọc vai trò"
          class="w-full lg:w-44"
          @change="adminStore.roleFilter = ($event.target as HTMLSelectElement).value as RoleFilter; applyFilter()"
        >
          <option value="ALL">Mọi vai trò</option>
          <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </NativeSelect>

        <NativeSelect
          :model-value="adminStore.statusFilter" aria-label="Lọc trạng thái"
          class="w-full lg:w-44"
          @change="adminStore.statusFilter = ($event.target as HTMLSelectElement).value as StatusFilter; applyFilter()"
        >
          <option value="ALL">Mọi trạng thái</option>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="LOCKED">Đã khoá</option>
        </NativeSelect>
      </Card>

      <!-- Bảng -->
      <Card class="bg-card border border-border rounded-2xl gap-0 py-0 shadow-sm overflow-hidden">
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
            <div class="divide-y divide-border">
              <div v-for="n in 6" :key="n" class="px-5 py-4 flex items-center gap-4">
                <Skeleton class="w-10 h-10 rounded-full bg-muted animate-pulse" />
                <div class="flex-1 space-y-2">
                  <Skeleton class="h-3 w-1/3 bg-muted rounded animate-pulse" />
                  <Skeleton class="h-3 w-1/4 bg-muted rounded animate-pulse" />
                </div>
                <Skeleton class="h-8 w-28 bg-muted rounded-lg animate-pulse" />
              </div>
            </div>
          </template>

          <div class="md:hidden grid gap-3 p-4"><article
                  v-for="user in adminStore.users"
                  :key="user.id"
                  class="rounded-xl border bg-card p-4 shadow-sm space-y-3 min-w-0"
                >
                  <div class="min-w-0 break-words">
                    <div class="flex items-center gap-3">
                      <Avatar size="lg"><AvatarFallback class="bg-primary/10 text-primary">{{ user.fullName.slice(0, 2).toUpperCase() }}</AvatarFallback></Avatar>
                      <div class="min-w-0">
                        <p class="font-medium text-foreground break-all">
                          {{ user.fullName }}
                          <span
                            v-if="isSelf(user)"
                            class="ml-1 text-[11px] font-normal text-primary"
                          >(bạn)</span>
                        </p>
                        <p class="text-xs text-muted-foreground break-all">{{ user.email }}</p>
                      </div>
                    </div>
                  </div>

                  <div class="min-w-0 break-words">
                    <!-- Không tự đổi vai trò của chính mình: chỉ hiện badge. -->
                    <Badge v-if="isSelf(user)" :variant="roleVariant[user.role]">{{ ROLE_OPTIONS.find(option => option.value === user.role)?.label }}</Badge>
                    <NativeSelect
                      v-else
                      :model-value="user.role"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      class="w-full max-w-44" size="sm"
                      :aria-label="`Vai trò của ${user.fullName}`"
                      @change="handleRoleChange(user, $event)"
                    >
                      <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </NativeSelect>
                  </div>

                  <div class="min-w-0 break-words">
                    <Badge :variant="user.isActive ? 'success' : 'danger'">{{ user.isActive ? 'Hoạt động' : 'Bị khoá' }}</Badge>
                  </div>

                  <div class="min-w-0 break-words text-xs text-muted-foreground">
                    Ngày tạo: {{ formatDateTime(user.createdAt) }}
                  </div>

                  <div class="min-w-0 break-words">
                    <Button
                      type="button"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      :class="
                        user.isActive
                          ? 'text-danger border-danger/30 hover:bg-danger/10'
                          : 'text-success border-success/30 hover:bg-success/10'
                      "
                      @click="requestToggleLock(user)"
                     variant="outline" size="sm">
                      <span v-if="adminStore.updatingId === user.id">...</span>
                      <span v-else>{{ user.isActive ? 'Khoá' : 'Mở khoá' }}</span>
                    </Button>
                  </div>
                </article></div>
          <div class="hidden md:block min-w-0">
            <Table class="w-full table-fixed text-sm [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal">
              <TableHeader class="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                <TableRow>
                  <TableHead class="px-5 py-3 font-semibold">Tài khoản</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Vai trò</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Trạng thái</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Ngày tạo</TableHead>
                  <TableHead class="px-5 py-3 font-semibold text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody class="divide-y divide-border">
                <TableRow
                  v-for="user in adminStore.users"
                  :key="user.id"
                  class="hover:bg-surface/70 transition-colors"
                >
                  <TableCell class="px-5 py-4">
                    <div class="flex items-center gap-3">
                      <Avatar size="lg"><AvatarFallback class="bg-primary/10 text-primary">{{ user.fullName.slice(0, 2).toUpperCase() }}</AvatarFallback></Avatar>
                      <div class="min-w-0">
                        <p class="font-medium text-foreground truncate">
                          {{ user.fullName }}
                          <span
                            v-if="isSelf(user)"
                            class="ml-1 text-[11px] font-normal text-primary"
                          >(bạn)</span>
                        </p>
                        <p class="text-xs text-muted-foreground truncate">{{ user.email }}</p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell class="px-5 py-4">
                    <!-- Không tự đổi vai trò của chính mình: chỉ hiện badge. -->
                    <Badge v-if="isSelf(user)" :variant="roleVariant[user.role]">{{ ROLE_OPTIONS.find(option => option.value === user.role)?.label }}</Badge>
                    <NativeSelect
                      v-else
                      :model-value="user.role"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      class="w-full max-w-44" size="sm"
                      :aria-label="`Vai trò của ${user.fullName}`"
                      @change="handleRoleChange(user, $event)"
                    >
                      <option v-for="option in ROLE_OPTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </NativeSelect>
                  </TableCell>

                  <TableCell class="px-5 py-4">
                    <Badge :variant="user.isActive ? 'success' : 'danger'">{{ user.isActive ? 'Hoạt động' : 'Bị khoá' }}</Badge>
                  </TableCell>

                  <TableCell class="px-5 py-4 text-xs text-muted-foreground whitespace-nowrap">
                    {{ formatDateTime(user.createdAt) }}
                  </TableCell>

                  <TableCell class="px-5 py-4 text-right">
                    <Button
                      type="button"
                      :disabled="adminStore.updatingId === user.id || isSelf(user)"
                      :class="
                        user.isActive
                          ? 'text-danger border-danger/30 hover:bg-danger/10'
                          : 'text-success border-success/30 hover:bg-success/10'
                      "
                      @click="requestToggleLock(user)"
                     variant="outline" size="sm">
                      <span v-if="adminStore.updatingId === user.id">...</span>
                      <span v-else>{{ user.isActive ? 'Khoá' : 'Mở khoá' }}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </DataState>
      </Card>

      <!-- Phân trang -->
      <div
        v-if="adminStore.totalPages > 1 && adminStore.users.length > 0"
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground">
          Tổng <strong class="text-foreground">{{ adminStore.total }}</strong> tài khoản
        </p>

        <div class="flex items-center gap-2">
          <Button
            type="button"
            :disabled="adminStore.page === 1"
            @click="changePage(adminStore.page - 1)"
           variant="outline" size="sm">
            Trước
          </Button>

          <span class="text-sm text-muted-foreground px-3">
            Trang <strong class="text-foreground">{{ adminStore.page }}</strong>
            / {{ adminStore.totalPages }}
          </span>

          <Button
            type="button"
            :disabled="adminStore.page === adminStore.totalPages"
            @click="changePage(adminStore.page + 1)"
           variant="outline" size="sm">
            Sau
          </Button>
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
