<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { AlertCircle, ArrowLeft, ScanLine, Trash2, UserPlus, Users } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import DataState from '@/components/DataState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useStaffStore } from '@/stores/staff';
import type { EventStaffMember } from '@/stores/staff';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/format';

/**
 * Nhân viên soát vé của một sự kiện. Nhân viên chỉ quét vé và xem số người đã vào
 * cổng; không sửa sự kiện, loại vé hay mã giảm giá.
 */
const route = useRoute();
const staffStore = useStaffStore();
const toast = useToastStore();

const eventId = computed(() => String(route.params.id));
const email = ref('');
const adding = ref(false);
const formError = ref('');
const pendingRemove = ref<EventStaffMember | null>(null);
const removing = ref(false);

const full = computed(() => staffStore.staff.length >= staffStore.maxStaff);

watch(eventId, (id) => {
  staffStore.reset();
  email.value = '';
  formError.value = '';
  void staffStore.fetchStaff(id);
}, { immediate: true });

const submit = async () => {
  const value = email.value.trim();
  formError.value = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    formError.value = 'Vui lòng nhập email hợp lệ.';
    return;
  }
  adding.value = true;
  try {
    const member = await staffStore.addStaff(eventId.value, value);
    toast.success(`Đã thêm ${member.fullName} làm nhân viên soát vé`);
    email.value = '';
  } catch (error: any) {
    formError.value = error?.response?.data?.message || 'Không thêm được nhân viên. Vui lòng thử lại.';
  } finally {
    adding.value = false;
  }
};

const confirmRemove = async () => {
  if (!pendingRemove.value) return;
  removing.value = true;
  try {
    const name = pendingRemove.value.fullName;
    await staffStore.removeStaff(eventId.value, pendingRemove.value.userId);
    toast.success(`Đã gỡ ${name}`);
    pendingRemove.value = null;
  } catch (error: any) {
    toast.error(error?.response?.data?.message || 'Không gỡ được nhân viên. Vui lòng thử lại.');
  } finally {
    removing.value = false;
  }
};
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-4xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <Button as-child variant="outline" size="sm">
          <router-link :to="{ name: 'MyEvents' }"><ArrowLeft class="size-4" aria-hidden="true" />Sự kiện của tôi</router-link>
        </Button>
        <Button as-child size="sm">
          <router-link :to="{ name: 'CheckIn', params: { id: eventId } }"><ScanLine class="size-4" aria-hidden="true" />Mở trang soát vé</router-link>
        </Button>
      </div>

      <header class="space-y-2">
        <p class="flex items-center gap-2 text-sm font-medium text-primary"><Users class="size-4" aria-hidden="true" />Nhân viên soát vé</p>
        <h1 class="break-words text-3xl font-extrabold tracking-tight sm:text-4xl">{{ staffStore.eventTitle || 'Nhân viên soát vé' }}</h1>
        <p class="text-sm text-muted-foreground">
          Nhân viên chỉ được quét vé và xem số người đã vào cổng của sự kiện này, không sửa được sự kiện.
          Họ dùng tài khoản EventHub của chính mình và mở mục “Soát vé” trong menu.
        </p>
      </header>

      <Card class="gap-4 rounded-lg border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-semibold tracking-tight">Thêm nhân viên</h2>
          <span class="text-sm tabular-nums text-muted-foreground">{{ staffStore.staff.length }} / {{ staffStore.maxStaff }} người</span>
        </div>
        <form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate @submit.prevent="submit">
          <div class="flex-1 space-y-2">
            <Label for="staff-email">Email nhân viên</Label>
            <Input
              id="staff-email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="off"
              placeholder="nhanvien@example.com"
              :disabled="full"
              :aria-invalid="formError ? true : undefined"
            />
          </div>
          <Button type="submit" :disabled="adding || full">
            <UserPlus class="size-4" aria-hidden="true" />{{ adding ? 'Đang thêm...' : 'Thêm' }}
          </Button>
        </form>
        <p v-if="full" class="text-sm text-muted-foreground">Đã đủ số nhân viên tối đa. Gỡ bớt người để thêm người mới.</p>
        <div v-if="formError" role="alert" class="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span class="break-words">{{ formError }}</span>
        </div>
      </Card>

      <section aria-labelledby="staff-list-title" class="space-y-3">
        <h2 id="staff-list-title" class="text-lg font-semibold tracking-tight">Danh sách nhân viên</h2>
        <DataState
          :loading="staffStore.loading"
          :loaded="staffStore.loaded"
          :error="staffStore.errorMessage"
          :empty="staffStore.staff.length === 0"
          empty-title="Chưa có nhân viên soát vé"
          empty-description="Nhập email tài khoản EventHub của nhân viên ở khung trên để thêm."
          @retry="staffStore.fetchStaff(eventId)"
        >
          <ul class="divide-y divide-border rounded-lg border border-border bg-background">
            <li v-for="member in staffStore.staff" :key="member.userId" class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0 space-y-1">
                <p class="flex flex-wrap items-center gap-2 font-medium">
                  <span class="break-words">{{ member.fullName }}</span>
                  <Badge v-if="!member.isActive" variant="outline" class="text-danger">Tài khoản bị khoá</Badge>
                </p>
                <p class="break-all text-sm text-muted-foreground">{{ member.email }}</p>
                <p class="text-xs text-muted-foreground">
                  Đã soát <span class="font-semibold tabular-nums text-foreground">{{ member.checkedInCount }}</span> vé · thêm lúc {{ formatDateTime(member.addedAt) }}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="self-start sm:self-auto"
                :aria-label="`Gỡ ${member.fullName}`"
                @click="pendingRemove = member"
              ><Trash2 class="size-4" aria-hidden="true" />Gỡ</Button>
            </li>
          </ul>
        </DataState>
      </section>
    </div>

    <ConfirmDialog
      :open="pendingRemove !== null"
      title="Gỡ nhân viên soát vé?"
      :message="pendingRemove ? `${pendingRemove.fullName} sẽ không quét vé được cho sự kiện này nữa. Số vé họ đã soát vẫn được giữ.` : ''"
      confirm-label="Gỡ nhân viên"
      danger
      :loading="removing"
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </main>
</template>
