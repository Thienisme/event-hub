<script setup lang="ts">
/**
 * Trang kết quả thanh toán: cổng (VNPay/MoMo) chuyển trình duyệt về đây với
 * query gốc, trang này gọi lại route `return` tương ứng của BE để xác minh
 * chữ ký và biết kết quả thật.
 *
 * Chỉ gọi MỘT lần: query là dữ liệu tĩnh của lần thanh toán đó, gọi lại khi
 * re-render sẽ hỏi BE hai lần cho cùng một giao dịch.
 */
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import apiClient from '../api/axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CircleCheck, CircleAlert, CircleX, Loader2 } from '@lucide/vue';

type ResultState = 'loading' | 'success' | 'failed' | 'needsRefund' | 'invalid';

const route = useRoute();

const state = ref<ResultState>('loading');

/** Đối tác đã gọi route return chưa (chống gọi lại khi component re-render). */
let requested = false;

onMounted(async () => {
  if (requested) return;
  requested = true;

  const provider = String(route.query.provider ?? '').toLowerCase();
  if (provider !== 'vnpay' && provider !== 'momo') {
    state.value = 'invalid';
    return;
  }

  // Giữ nguyên các tham số cổng trả về, chỉ bỏ `provider`
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (key === 'provider') continue;
    params[key] = Array.isArray(value) ? String(value[0] ?? '') : String(value);
  }

  try {
    const response = await apiClient.get<{ data: { status: 'SUCCEEDED' | 'FAILED' | 'PENDING'; orderId: string; needsRefund: boolean } }>(
      `/payments/${provider}/return`,
      { params }
    );
    const result = response.data.data;

    if (result?.needsRefund) {
      // Đơn hết hạn giữ chỗ trước khi thanh toán xong -> không có vé, cần hoàn tiền
      state.value = 'needsRefund';
    } else if (result?.status === 'SUCCEEDED') {
      state.value = 'success';
    } else {
      // FAILED và cả PENDING: người dùng có thể thử lại trong mục Vé của tôi
      state.value = 'failed';
    }
  } catch {
    // Lỗi mạng / 5xx / chữ ký sai: coi như chưa thành công, hướng dẫn thử lại
    state.value = 'failed';
  }
});
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-surface px-4 py-12 text-foreground sm:px-6">
    <Card class="w-full max-w-lg shadow-none ring-0 border border-border bg-background rounded-lg">
      <CardContent class="space-y-6 p-8 text-center sm:p-10">
        <div
          class="mx-auto flex size-16 items-center justify-center rounded-full"
          :class="{
            'bg-success/10': state === 'success',
            'bg-danger/10': state === 'failed' || state === 'invalid',
            'bg-warning/10': state === 'needsRefund',
            'bg-muted': state === 'loading',
          }"
        >
          <Loader2 v-if="state === 'loading'" class="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <CircleCheck v-else-if="state === 'success'" class="size-8 text-success" aria-hidden="true" />
          <CircleX v-else-if="state === 'failed'" class="size-8 text-danger" aria-hidden="true" />
          <CircleAlert v-else-if="state === 'needsRefund'" class="size-8 text-warning" aria-hidden="true" />
          <CircleAlert v-else class="size-8 text-muted-foreground" aria-hidden="true" />
        </div>

        <div class="space-y-2">
          <h1 class="text-2xl font-bold tracking-tight">
            {{ state === 'loading' ? 'Đang xác nhận thanh toán...' : state === 'success' ? 'Thanh toán thành công' : state === 'needsRefund' ? 'Đơn đã hết hạn giữ chỗ' : 'Thanh toán chưa thành công' }}
          </h1>
          <p class="text-sm leading-relaxed text-muted-foreground">
            <template v-if="state === 'loading'">Vui lòng chờ trong giây lát, chúng tôi đang kiểm tra kết quả từ cổng thanh toán.</template>
            <template v-else-if="state === 'success'">Thanh toán thành công, vé đã được gửi tới email của bạn</template>
            <template v-else-if="state === 'needsRefund'">Đơn đã hết hạn giữ chỗ trước khi thanh toán xong. Chúng tôi sẽ liên hệ hoàn tiền.</template>
            <template v-else-if="state === 'invalid'">Không nhận diện được cổng thanh toán của liên kết này.</template>
            <template v-else>Thanh toán chưa thành công, bạn có thể thử lại trong mục Vé của tôi</template>
          </p>
        </div>

        <Button as-child class="w-full rounded-md sm:w-auto">
          <router-link :to="{ name: 'MyOrders' }">Xem vé của tôi</router-link>
        </Button>
      </CardContent>
    </Card>
  </main>
</template>
