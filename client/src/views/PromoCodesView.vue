<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Percent, Plus, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DateTimePicker from '@/components/DateTimePicker.vue';
import DataState from '@/components/DataState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { usePromoStore } from '@/stores/promo';
import type { PromoCode, PromoDiscountType } from '@/stores/promo';
import { useToastStore } from '@/stores/toast';
import { formatDateTime, formatPrice, fromAppDateTimeInput } from '@/utils/format';

/** Mã hợp lệ theo hợp đồng API: 3..32 ký tự A-Z 0-9 _ - (đã viết hoa). */
const CODE_PATTERN = /^[A-Z0-9_-]+$/;

const route = useRoute();
const promoStore = usePromoStore();
const toastStore = useToastStore();

const eventId = computed(() => String(route.params.id));

/** Form tạo mã (trường nhập là chuỗi để ô input để trống được). */
const form = reactive({
  code: '',
  discountType: 'PERCENT' as PromoDiscountType,
  discountValue: '',
  maxUses: '',
  perUserLimit: '1',
  startsAt: '',
  endsAt: '',
});

const fieldErrors = reactive({
  code: '',
  discountValue: '',
  maxUses: '',
  perUserLimit: '',
  endsAt: '',
});

const creating = ref(false);
const togglingId = ref('');
const pendingDelete = ref<PromoCode | null>(null);
const deleteBusy = ref(false);

const valueLabel = computed(() =>
  form.discountType === 'PERCENT' ? 'Giá trị giảm (%)' : 'Giá trị giảm (₫)'
);

/**
 * Ô `type="number"` khiến v-model trả về kiểu số (Vue tự ép kiểu), ô trống lại là chuỗi:
 * luôn đưa về chuỗi trước khi `trim`, nếu không handler ném TypeError và form im lặng.
 */
const asText = (raw: unknown): string => String(raw ?? '').trim();

/** Chuẩn hoá số nguyên dương từ ô nhập; trả null khi không hợp lệ. */
function parsePositiveInteger(raw: unknown): number | null {
  if (asText(raw) === '') return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function validateForm(): boolean {
  fieldErrors.code = '';
  fieldErrors.discountValue = '';
  fieldErrors.maxUses = '';
  fieldErrors.perUserLimit = '';
  fieldErrors.endsAt = '';

  const code = form.code.trim().toUpperCase();
  if (!code) {
    fieldErrors.code = 'Vui lòng nhập mã giảm giá.';
  } else if (code.length < 3 || code.length > 32) {
    fieldErrors.code = 'Mã phải từ 3 đến 32 ký tự.';
  } else if (!CODE_PATTERN.test(code)) {
    fieldErrors.code = 'Mã chỉ gồm chữ hoa, số, dấu gạch dưới (_) và gạch ngang (-).';
  }

  const value = Number(form.discountValue);
  if (asText(form.discountValue) === '') {
    fieldErrors.discountValue = 'Vui lòng nhập giá trị giảm.';
  } else if (form.discountType === 'PERCENT') {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      fieldErrors.discountValue = 'Phần trăm phải là số nguyên từ 1 đến 100.';
    }
  } else if (Number.isNaN(value) || value <= 0) {
    fieldErrors.discountValue = 'Số tiền giảm phải lớn hơn 0.';
  }

  if (asText(form.maxUses) !== '' && parsePositiveInteger(form.maxUses) === null) {
    fieldErrors.maxUses = 'Số lượt tối đa phải là số nguyên dương, hoặc để trống để không giới hạn.';
  }

  if (parsePositiveInteger(form.perUserLimit) === null) {
    fieldErrors.perUserLimit = 'Số lần mỗi tài khoản phải là số nguyên dương.';
  }

  if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) {
    fieldErrors.endsAt = 'Thời gian kết thúc phải sau thời gian bắt đầu.';
  }

  return !fieldErrors.code && !fieldErrors.discountValue && !fieldErrors.maxUses && !fieldErrors.perUserLimit && !fieldErrors.endsAt;
}

function resetForm(): void {
  form.code = '';
  form.discountType = 'PERCENT';
  form.discountValue = '';
  form.maxUses = '';
  form.perUserLimit = '1';
  form.startsAt = '';
  form.endsAt = '';
  fieldErrors.code = '';
  fieldErrors.discountValue = '';
  fieldErrors.maxUses = '';
  fieldErrors.perUserLimit = '';
  fieldErrors.endsAt = '';
}

async function submitCreate() {
  if (!validateForm()) return;

  creating.value = true;
  try {
    const body = {
      code: form.code.trim().toUpperCase(),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      maxUses: parsePositiveInteger(form.maxUses),
      perUserLimit: parsePositiveInteger(form.perUserLimit) ?? 1,
      startsAt: form.startsAt ? fromAppDateTimeInput(form.startsAt) : null,
      endsAt: form.endsAt ? fromAppDateTimeInput(form.endsAt) : null,
    };
    await promoStore.create(eventId.value, body);
    toastStore.success('Đã tạo mã giảm giá!');
    resetForm();
  } catch (error: any) {
    toastStore.error(error.response?.data?.message || 'Tạo mã giảm giá thất bại!');
  } finally {
    creating.value = false;
  }
}

async function toggleActive(code: PromoCode) {
  togglingId.value = code.id;
  try {
    await promoStore.update(code.id, { active: !code.active });
    toastStore.success(code.active ? 'Đã tắt mã!' : 'Đã bật mã!');
  } catch (error: any) {
    toastStore.error(error.response?.data?.message || 'Đổi trạng thái mã thất bại!');
  } finally {
    togglingId.value = '';
  }
}

async function confirmDelete() {
  if (!pendingDelete.value) return;

  deleteBusy.value = true;
  try {
    await promoStore.remove(pendingDelete.value.id);
    toastStore.success('Đã xoá mã giảm giá!');
    pendingDelete.value = null;
  } catch (error: any) {
    toastStore.error(error.response?.data?.message || 'Xoá mã giảm giá thất bại!');
  } finally {
    deleteBusy.value = false;
  }
}

const deleteConfirmMessage = (code: PromoCode | null) =>
  code
    ? code.usedCount > 0
      ? 'Mã này đã được dùng nên server sẽ không cho xoá, bạn chỉ có thể tắt. Vẫn thử xoá?'
      : `Mã "${code.code}" sẽ bị xoá vĩnh viễn.`
    : '';

/** "15%" hoặc "50.000 ₫" (Decimal là chuỗi -> ép số trước khi format). */
const discountLabel = (code: PromoCode) =>
  code.discountType === 'PERCENT' ? `${Number(code.discountValue)}%` : formatPrice(code.discountValue);

/** "3 / 100" hoặc "3 / ∞" khi không giới hạn lượt. */
const usesLabel = (code: PromoCode) => `${code.usedCount} / ${code.maxUses ?? '∞'}`;

const periodLabel = (code: PromoCode) => {
  const start = code.startsAt ? formatDateTime(code.startsAt) : null;
  const end = code.endsAt ? formatDateTime(code.endsAt) : null;
  if (start && end) return `${start} → ${end}`;
  if (start) return `Từ ${start}`;
  if (end) return `Đến ${end}`;
  return 'Không giới hạn thời gian';
};

watch(
  () => String(route.params.id),
  (id) => {
    promoStore.reset();
    void promoStore.list(id);
  },
  { immediate: true }
);

onUnmounted(() => {
  promoStore.reset();
});
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <Button as-child variant="outline" size="sm">
        <router-link :to="{ name: 'MyEvents' }"><ArrowLeft class="size-4" aria-hidden="true" />Sự kiện của tôi</router-link>
      </Button>

      <header class="space-y-2">
        <p class="flex items-center gap-2 text-sm font-medium text-primary"><Percent class="size-4" aria-hidden="true" />Ưu đãi</p>
        <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Mã giảm giá</h1>
        <p class="text-sm text-muted-foreground">Tạo và quản lý mã ưu đãi cho người mua vé của sự kiện này</p>
      </header>

      <!-- Form tạo mã -->
      <Card class="gap-5 rounded-lg border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
        <h2 class="text-lg font-semibold tracking-tight">Tạo mã mới</h2>
        <form class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submitCreate">
          <div class="space-y-2">
            <Label for="promo-code">Mã</Label>
            <Input
              id="promo-code"
              v-model="form.code"
              type="text"
              placeholder="VD: TET2026"
              maxlength="32"
              autocomplete="off"
              :aria-invalid="fieldErrors.code ? true : undefined"
              @input="form.code = form.code.toUpperCase()"
            />
            <p v-if="fieldErrors.code" class="text-xs text-danger">{{ fieldErrors.code }}</p>
            <p v-else class="text-xs text-muted-foreground">3–32 ký tự, gồm chữ hoa, số, _ và -</p>
          </div>

          <div class="space-y-2">
            <Label for="promo-type">Loại giảm</Label>
            <NativeSelect id="promo-type" v-model="form.discountType">
              <NativeSelectOption value="PERCENT">Phần trăm</NativeSelectOption>
              <NativeSelectOption value="FIXED">Số tiền</NativeSelectOption>
            </NativeSelect>
          </div>

          <div class="space-y-2">
            <Label for="promo-value">{{ valueLabel }}</Label>
            <Input
              id="promo-value"
              v-model="form.discountValue"
              type="number"
              :min="form.discountType === 'PERCENT' ? 1 : 0"
              :max="form.discountType === 'PERCENT' ? 100 : undefined"
              step="1"
              placeholder="15"
              :aria-invalid="fieldErrors.discountValue ? true : undefined"
            />
            <p v-if="fieldErrors.discountValue" class="text-xs text-danger">{{ fieldErrors.discountValue }}</p>
          </div>

          <div class="space-y-2">
            <Label for="promo-max-uses">Số lượt tối đa</Label>
            <Input
              id="promo-max-uses"
              v-model="form.maxUses"
              type="number"
              min="1"
              step="1"
              placeholder="Không giới hạn"
              :aria-invalid="fieldErrors.maxUses ? true : undefined"
            />
            <p v-if="fieldErrors.maxUses" class="text-xs text-danger">{{ fieldErrors.maxUses }}</p>
            <p v-else class="text-xs text-muted-foreground">Để trống nếu không giới hạn</p>
          </div>

          <div class="space-y-2">
            <Label for="promo-per-user">Số lần mỗi tài khoản</Label>
            <Input
              id="promo-per-user"
              v-model="form.perUserLimit"
              type="number"
              min="1"
              step="1"
              :aria-invalid="fieldErrors.perUserLimit ? true : undefined"
            />
            <p v-if="fieldErrors.perUserLimit" class="text-xs text-danger">{{ fieldErrors.perUserLimit }}</p>
          </div>

          <div class="space-y-2">
            <Label for="promo-start">Thời gian bắt đầu</Label>
            <DateTimePicker id="promo-start" v-model="form.startsAt" placeholder="Tuỳ chọn" />
          </div>

          <div class="space-y-2">
            <Label for="promo-end">Thời gian kết thúc</Label>
            <DateTimePicker id="promo-end" v-model="form.endsAt" :min-date="form.startsAt || undefined" placeholder="Tuỳ chọn" :invalid="fieldErrors.endsAt ? true : undefined" />
            <p v-if="fieldErrors.endsAt" class="text-xs text-danger">{{ fieldErrors.endsAt }}</p>
          </div>

          <div class="sm:col-span-2 sm:justify-self-end">
            <Button type="submit" :disabled="creating">
              <Plus class="size-4" aria-hidden="true" />{{ creating ? 'Đang tạo...' : 'Tạo mã' }}
            </Button>
          </div>
        </form>
      </Card>

      <!-- Danh sách mã -->
      <DataState
        :loading="promoStore.loading"
        :loaded="promoStore.loaded"
        :error="promoStore.errorMessage"
        :empty="promoStore.codes.length === 0"
        empty-title="Sự kiện chưa có mã giảm giá"
        empty-description="Tạo mã đầu tiên ở khung trên để tặng ưu đãi cho người mua vé."
      >
        <template #skeleton>
          <div class="divide-y divide-border rounded-lg border border-border bg-background">
            <div v-for="n in 3" :key="n" class="flex items-center justify-between gap-4 px-4 py-4">
              <div class="w-1/3 space-y-2">
                <div class="h-4 w-20 animate-pulse rounded bg-muted" />
                <div class="h-3 w-28 animate-pulse rounded bg-muted" />
              </div>
              <div class="h-5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </template>

        <!-- Bảng: từ sm trở lên -->
        <div class="hidden sm:block">
          <Card class="overflow-hidden rounded-lg border border-border bg-background py-0 shadow-none ring-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="px-4 py-3">Mã</TableHead>
                  <TableHead class="px-4 py-3">Mức giảm</TableHead>
                  <TableHead class="px-4 py-3">Đã dùng</TableHead>
                  <TableHead class="px-4 py-3">Thời hạn</TableHead>
                  <TableHead class="px-4 py-3">Trạng thái</TableHead>
                  <TableHead class="px-4 py-3 text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="code in promoStore.codes" :key="code.id">
                  <TableCell class="px-4 py-3 font-semibold">{{ code.code }}</TableCell>
                  <TableCell class="px-4 py-3 tabular-nums">{{ discountLabel(code) }}</TableCell>
                  <TableCell class="px-4 py-3 tabular-nums">{{ usesLabel(code) }}</TableCell>
                  <TableCell class="px-4 py-3 text-sm text-muted-foreground">
                    <span class="tabular-nums">{{ periodLabel(code) }}</span>
                  </TableCell>
                  <TableCell class="px-4 py-3">
                    <Badge variant="success" v-if="code.active">Đang bật</Badge>
                    <Badge variant="muted" v-else>Đã tắt</Badge>
                  </TableCell>
                  <TableCell class="px-4 py-3 text-right">
                    <div class="inline-flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" :disabled="togglingId === code.id" @click="toggleActive(code)">
                        {{ code.active ? 'Tắt' : 'Bật' }}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" class="text-destructive" @click="pendingDelete = code">
                        <Trash2 class="size-4" aria-hidden="true" />Xoá
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>

        <!-- Thẻ xếp dọc: dưới sm (mobile 360px) -->
        <div class="space-y-3 sm:hidden">
          <Card v-for="code in promoStore.codes" :key="code.id" class="gap-3 rounded-lg border border-border bg-background p-4 shadow-none ring-0">
            <div class="flex items-center justify-between gap-3">
              <p class="font-semibold">{{ code.code }}</p>
              <Badge variant="success" v-if="code.active">Đang bật</Badge>
              <Badge variant="muted" v-else>Đã tắt</Badge>
            </div>
            <dl class="space-y-1 text-sm">
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Mức giảm</dt>
                <dd class="tabular-nums">{{ discountLabel(code) }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted-foreground">Đã dùng</dt>
                <dd class="tabular-nums">{{ usesLabel(code) }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="shrink-0 text-muted-foreground">Thời hạn</dt>
                <dd class="text-right tabular-nums">{{ periodLabel(code) }}</dd>
              </div>
            </dl>
            <div class="flex items-center gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" :disabled="togglingId === code.id" @click="toggleActive(code)">
                {{ code.active ? 'Tắt' : 'Bật' }}
              </Button>
              <Button type="button" variant="ghost" size="sm" class="ml-auto text-destructive" @click="pendingDelete = code">
                <Trash2 class="size-4" aria-hidden="true" />Xoá
              </Button>
            </div>
          </Card>
        </div>
      </DataState>
    </div>

    <!-- Xác nhận xoá -->
    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Xoá mã giảm giá?"
      :message="deleteConfirmMessage(pendingDelete)"
      confirm-label="Xoá mã"
      danger
      :loading="deleteBusy"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </main>
</template>
