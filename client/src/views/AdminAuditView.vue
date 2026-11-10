<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

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

const actionLabel = (log: AdminAuditLog) => ACTION_LABEL[log.action] ?? log.action;

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
  <div class="min-h-screen bg-surface py-8 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Đầu trang -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold text-foreground tracking-tight">Nhật ký quản trị</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Mọi thao tác đổi vai trò, khoá và mở khoá tài khoản đều được ghi lại
          </p>
        </div>

        <Button
          type="button"
          @click="router.push({ name: 'AdminDashboard' })"
         variant="outline" size="sm">
          <ArrowLeft class="size-4" aria-hidden="true" /> Về tổng quan
        </Button>
      </div>

      <!-- Bảng -->
      <Card class="bg-card border border-border rounded-2xl gap-0 py-0 shadow-sm overflow-hidden">
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
            <div class="divide-y divide-border">
              <div v-for="n in 6" :key="n" class="px-5 py-4 flex items-center gap-4">
                <Skeleton class="h-3 w-32 bg-muted rounded animate-pulse" />
                <div class="flex-1 space-y-2">
                  <Skeleton class="h-3 w-1/3 bg-muted rounded animate-pulse" />
                  <Skeleton class="h-3 w-1/4 bg-muted rounded animate-pulse" />
                </div>
                <Skeleton class="h-3 w-24 bg-muted rounded animate-pulse" />
              </div>
            </div>
          </template>

          <div class="md:hidden grid gap-3 p-4"><article v-for="log in adminStore.auditLogs" :key="log.id" class="rounded-xl border bg-card p-4 shadow-sm space-y-3 min-w-0">
                  <div class="min-w-0 break-words">
                    <Badge variant="outline">{{ actionLabel(log) }}</Badge>
                  </div>

                  <div class="min-w-0 break-all"><p class="text-xs text-muted-foreground">Đối tượng</p>{{ log.metadata?.email || log.targetId || '—' }}</div><div class="min-w-0 break-words"><p class="max-w-full break-all" :title="describe(log)">
                    {{ describe(log) || '—' }}</p>
                  </div>

                  <div class="min-w-0 break-words">
                    <p class="text-xs text-muted-foreground md:hidden">Người thực hiện</p><p class="font-medium text-foreground break-all">{{ actorName(log) }}</p>
                    <p class="text-xs text-muted-foreground break-all">{{ actorEmail(log) }}</p>
                  </div>

                  <div class="min-w-0 break-words">
                    {{ formatDateTime(log.createdAt) }}
                  </div>
                </article></div>
          <div class="hidden md:block min-w-0">
            <Table class="w-full table-fixed text-sm [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal">
              <TableHeader class="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                <TableRow>
                  <TableHead class="px-5 py-3 font-semibold">Thao tác</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Đối tượng</TableHead><TableHead class="px-5 py-3 font-semibold">Chi tiết</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Người thực hiện</TableHead>
                  <TableHead class="px-5 py-3 font-semibold">Thời điểm</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody class="divide-y divide-border">
                <TableRow v-for="log in adminStore.auditLogs" :key="log.id" class="hover:bg-surface/70 transition-colors">
                  <TableCell class="px-5 py-4">
                    <Badge variant="outline">{{ actionLabel(log) }}</Badge>
                  </TableCell>

                  <TableCell class="px-5 py-4 break-all">{{ log.metadata?.email || log.targetId || '—' }}</TableCell><TableCell class="px-5 py-4 text-foreground"><p class="max-w-64 truncate" :title="describe(log)">
                    {{ describe(log) || '—' }}</p>
                  </TableCell>

                  <TableCell class="px-5 py-4">
                    <p class="text-xs text-muted-foreground md:hidden">Người thực hiện</p><p class="font-medium text-foreground break-all">{{ actorName(log) }}</p>
                    <p class="text-xs text-muted-foreground break-all">{{ actorEmail(log) }}</p>
                  </TableCell>

                  <TableCell class="px-5 py-4 text-xs text-muted-foreground whitespace-nowrap">
                    {{ formatDateTime(log.createdAt) }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </DataState>
      </Card>

      <!-- Phân trang -->
      <div
        v-if="adminStore.auditTotalPages > 1 && adminStore.auditLogs.length > 0"
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground">
          Tổng <strong class="text-foreground">{{ adminStore.auditTotal }}</strong> thao tác
        </p>

        <div class="flex items-center gap-2">
          <Button
            type="button"
            :disabled="adminStore.auditPage === 1"
            @click="changePage(adminStore.auditPage - 1)"
           variant="outline" size="sm">
            Trước
          </Button>

          <span class="text-sm text-muted-foreground px-3">
            Trang <strong class="text-foreground">{{ adminStore.auditPage }}</strong>
            / {{ adminStore.auditTotalPages }}
          </span>

          <Button
            type="button"
            :disabled="adminStore.auditPage === adminStore.auditTotalPages"
            @click="changePage(adminStore.auditPage + 1)"
           variant="outline" size="sm">
            Sau
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
