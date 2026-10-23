<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';
import type { AdminAuditLog } from '../stores/admin';
import DataState from '../components/DataState.vue';
import { formatDateTime } from '../utils/format';

const router = useRouter();
const adminStore = useAdminStore();

/** Nhãn tiếng Việt cho từng hành động trong nhật ký. */
const ACTION_LABEL: Record<string, string> = {
  'user.role.updated': 'Đổi vai trò',
  'user.locked': 'Khoá tài khoản',
  'user.unlocked': 'Mở khoá tài khoản',
};

const ACTION_CLASS: Record<string, string> = {
  'user.role.updated': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'user.locked': 'bg-red-50 text-red-600 border-red-200',
  'user.unlocked': 'bg-green-50 text-green-700 border-green-200',
};

const actionLabel = (log: AdminAuditLog) => ACTION_LABEL[log.action] ?? log.action;

const actionClass = (log: AdminAuditLog) =>
  ACTION_CLASS[log.action] ?? 'bg-gray-100 text-gray-600 border-gray-200';

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: 'Khách hàng',
  ORGANIZER: 'Ban tổ chức',
  ADMIN: 'Quản trị viên',
};

/**
 * Mô tả thay đổi cụ thể của từng dòng nhật ký.
 *
 * `metadata` là JSON do server ghi kèm, nên có thể thiếu (bản ghi cũ) — phải
 * chịu được cả hai trường hợp thay vì tin chắc có đủ.
 */
const describe = (log: AdminAuditLog): string => {
  const meta = log.metadata ?? {};
  const target = meta.email ? `${meta.email}` : '';

  if (log.action === 'user.role.updated') {
    const from = ROLE_LABEL[String(meta.from)] ?? String(meta.from ?? '?');
    const to = ROLE_LABEL[String(meta.to)] ?? String(meta.to ?? '?');
    return target ? `${target}: ${from} → ${to}` : `${from} → ${to}`;
  }

  if (log.action === 'user.locked' || log.action === 'user.unlocked') {
    return target;
  }

  return '';
};

/**
 * Người thực hiện.
 *
 * `actor` null nghĩa là tài khoản đã bị xoá sau đó (khoá ngoại SET NULL) —
 * nhật ký vẫn còn nhờ `actorEmail` chụp lại lúc ghi.
 */
const actorName = (log: AdminAuditLog): string =>
  log.actor?.fullName || log.actorEmail || 'Tài khoản đã bị xoá';

const actorEmail = (log: AdminAuditLog): string =>
  log.actor?.email || log.actorEmail || '';

const changePage = (page: number) => {
  if (page < 1 || page > adminStore.auditTotalPages) return;
  adminStore.auditPage = page;
  adminStore.reloadAuditLogs();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

onMounted(() => {
  adminStore.reloadAuditLogs();
});

onUnmounted(() => {
  adminStore.cancelAuditPending();
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">Nhật ký quản trị</h1>
          <p class="mt-1 text-sm text-gray-500">
            Mọi thao tác đổi vai trò, khoá và mở khoá tài khoản đều được ghi lại
          </p>
        </div>

        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          @click="router.push({ name: 'AdminDashboard' })"
        >
          ← Về tổng quan
        </button>
      </div>

      <!-- Bảng -->
      <div class="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <DataState
          :loading="adminStore.auditLoading"
          :loaded="adminStore.auditLoaded"
          :error="adminStore.auditErrorMessage"
          :empty="adminStore.auditLogs.length === 0"
          empty-title="Chưa có thao tác nào"
          empty-description="Các thao tác quản trị sẽ xuất hiện ở đây."
          @retry="adminStore.reloadAuditLogs()"
        >
          <template #skeleton>
            <div class="divide-y divide-gray-100">
              <div v-for="n in 6" :key="n" class="px-5 py-4 flex items-center gap-4">
                <div class="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
                <div class="flex-1 space-y-2">
                  <div class="h-3 w-1/3 bg-gray-200 rounded animate-pulse"></div>
                  <div class="h-3 w-1/4 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div class="h-3 w-24 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </div>
          </template>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th class="px-5 py-3 font-semibold">Thao tác</th>
                  <th class="px-5 py-3 font-semibold">Chi tiết</th>
                  <th class="px-5 py-3 font-semibold">Người thực hiện</th>
                  <th class="px-5 py-3 font-semibold">Thời điểm</th>
                </tr>
              </thead>

              <tbody class="divide-y divide-gray-100">
                <tr v-for="log in adminStore.auditLogs" :key="log.id" class="hover:bg-gray-50/70 transition-colors">
                  <td class="px-5 py-4">
                    <span
                      class="px-2.5 py-1 text-xs font-semibold rounded-full border whitespace-nowrap"
                      :class="actionClass(log)"
                    >
                      {{ actionLabel(log) }}
                    </span>
                  </td>

                  <td class="px-5 py-4 text-gray-700">
                    {{ describe(log) || '—' }}
                  </td>

                  <td class="px-5 py-4">
                    <p class="font-medium text-gray-900">{{ actorName(log) }}</p>
                    <p class="text-xs text-gray-500">{{ actorEmail(log) }}</p>
                  </td>

                  <td class="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                    {{ formatDateTime(log.createdAt) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      <!-- Phân trang -->
      <div
        v-if="adminStore.auditTotalPages > 1 && adminStore.auditLogs.length > 0"
        class="flex items-center justify-between gap-3"
      >
        <p class="text-sm text-gray-500">
          Tổng <strong class="text-gray-900">{{ adminStore.auditTotal }}</strong> thao tác
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="adminStore.auditPage === 1"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(adminStore.auditPage - 1)"
          >
            Trước
          </button>

          <span class="text-sm text-gray-600 px-3">
            Trang <strong class="text-gray-900">{{ adminStore.auditPage }}</strong>
            / {{ adminStore.auditTotalPages }}
          </span>

          <button
            type="button"
            :disabled="adminStore.auditPage === adminStore.auditTotalPages"
            class="px-3.5 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="changePage(adminStore.auditPage + 1)"
          >
            Sau
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
