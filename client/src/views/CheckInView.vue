<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import { QrcodeStream } from 'vue-qrcode-reader';
import { ArrowLeft, Camera, ScanLine } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import apiClient from '@/api/axios';
import { formatDateTime } from '@/utils/format';

type Result = 'VALID' | 'ALREADY_USED' | 'NOT_FOUND' | 'WRONG_EVENT' | 'NOT_CONFIRMED';
interface CheckInResponse {
  result?: Result;
  message: string;
  ticket?: {
    ticketTypeName: string;
    eventTitle: string;
    holderName: string;
    checkedInAt?: string | null;
  };
}
interface Scan extends CheckInResponse { id: number; scannedAt: string }
interface Stats { eventTitle: string; total: number; checkedIn: number }

const route = useRoute();
const stats = ref<Stats | null>(null);
const statsError = ref('');
const statsLoading = ref(false);
const cameraEnabled = ref(false);
const cameraError = ref('');
const manualCode = ref('');
const submitting = ref(false);
const latest = ref<Scan | null>(null);
const history = ref<Scan[]>([]);
let sequence = 0;
let recentCodes = new Map<string, number>();
let controller = new AbortController();

function errorMessage(error: unknown, fallback: string): string {
  return isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || fallback : fallback;
}

async function loadStats(id: string, signal: AbortSignal) {
  statsLoading.value = true;
  statsError.value = '';
  try {
    const { data } = await apiClient.get<{ data: Stats }>(`/events/${encodeURIComponent(id)}/check-in/stats`, { signal });
    if (!signal.aborted) stats.value = data.data;
  } catch (error) {
    if (!signal.aborted) statsError.value = errorMessage(error, 'Không tải được thống kê. Vui lòng thử lại.');
  } finally {
    if (!signal.aborted) statsLoading.value = false;
  }
}

watch(() => String(route.params.id), (id, _, onCleanup) => {
  controller = new AbortController();
  const current = controller;
  stats.value = null;
  latest.value = null;
  history.value = [];
  recentCodes = new Map();
  manualCode.value = '';
  submitting.value = false;
  cameraEnabled.value = false;
  cameraError.value = '';
  void loadStats(id, current.signal);
  onCleanup(() => current.abort());
}, { immediate: true });

async function checkCode(rawCode: string) {
  const qrCode = rawCode.trim();
  const now = Date.now();
  if (!qrCode || submitting.value) return;
  if (now - (recentCodes.get(qrCode) ?? 0) < 3000) return;
  recentCodes = new Map([...recentCodes].filter(([, time]) => now - time < 3000));
  recentCodes.set(qrCode, now);
  submitting.value = true;
  const id = String(route.params.id);
  const signal = controller.signal;
  let response: CheckInResponse;
  try {
    const { data } = await apiClient.post<CheckInResponse>(`/events/${encodeURIComponent(id)}/check-in`, { qrCode }, { signal });
    response = data;
  } catch (error) {
    if (signal.aborted) return;
    const body = isAxiosError<CheckInResponse>(error) ? error.response?.data : undefined;
    response = body?.message ? body : { message: 'Không kiểm tra được vé. Kiểm tra kết nối rồi thử lại.' };
  } finally {
    if (!signal.aborted) submitting.value = false;
  }
  if (signal.aborted) return;
  const scan = { ...response, id: ++sequence, scannedAt: new Date().toISOString() };
  latest.value = scan;
  history.value = [scan, ...history.value].slice(0, 10);
  if (response.result === 'VALID') void loadStats(id, signal);
}

function detect(codes: { rawValue: string }[]) {
  if (cameraEnabled.value && codes[0]) void checkCode(codes[0].rawValue);
}

function handleCameraError(error: Error) {
  const messages: Record<string, string> = {
    NotAllowedError: 'Chưa được cấp quyền camera. Hãy cho phép camera trong trình duyệt rồi bật lại.',
    NotFoundError: 'Không tìm thấy camera trên thiết bị.',
    NotSupportedError: 'Camera cần kết nối HTTPS hoặc localhost. Hãy mở trang qua HTTPS.',
    NotReadableError: 'Không mở được camera. Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.',
    OverconstrainedError: 'Camera không hỗ trợ cấu hình quét này. Hãy thử thiết bị khác.',
    SecurityError: 'Trình duyệt chặn camera. Hãy kiểm tra quyền camera và kết nối HTTPS.',
  };
  cameraError.value = messages[error.name] || 'Không thể sử dụng camera trên trình duyệt này.';
  cameraEnabled.value = false;
}

function toggleCamera() {
  cameraError.value = '';
  if (!cameraEnabled.value && !window.isSecureContext) {
    cameraError.value = 'Camera cần kết nối HTTPS hoặc localhost. Bạn vẫn có thể nhập mã bên dưới.';
    return;
  }
  cameraEnabled.value = !cameraEnabled.value;
}

function title(scan: CheckInResponse): string {
  switch (scan.result) {
    case 'VALID': return 'Hợp lệ – mời vào';
    case 'ALREADY_USED': return `Vé đã dùng lúc ${formatDateTime(scan.ticket?.checkedInAt)}`;
    case 'NOT_FOUND': return 'Không tìm thấy vé';
    case 'WRONG_EVENT': return 'Vé không thuộc sự kiện này';
    case 'NOT_CONFIRMED': return 'Vé chưa được xác nhận';
    default: return 'Không thể kiểm tra vé';
  }
}

function resultClass(scan: CheckInResponse): string {
  if (scan.result === 'VALID') return 'border-green-600 bg-green-50 text-green-900';
  if (scan.result === 'ALREADY_USED') return 'border-orange-600 bg-orange-50 text-orange-900';
  return 'border-red-600 bg-red-50 text-red-900';
}
</script>

<template>
  <main class="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-7xl space-y-6">
      <Button as-child variant="outline" size="sm"><router-link :to="{ name: 'MyEvents' }"><ArrowLeft class="size-4" aria-hidden="true" />Sự kiện của tôi</router-link></Button>
      <header class="space-y-2">
        <p class="text-sm font-medium text-primary">Soát vé QR</p>
        <h1 class="break-words text-3xl font-bold tracking-tight">{{ stats?.eventTitle || 'Soát vé sự kiện' }}</h1>
        <p v-if="stats" class="text-xl font-semibold tabular-nums">Đã vào cổng: {{ stats.checkedIn }} / {{ stats.total }}</p>
        <p v-else-if="statsLoading" class="text-muted-foreground">Đang tải thống kê...</p>
        <div v-if="statsError" role="alert" class="space-y-2">
          <p class="text-sm text-danger">{{ statsError }}</p>
          <Button variant="outline" size="sm" :disabled="statsLoading" @click="loadStats(String(route.params.id), controller.signal)">Tải lại thống kê</Button>
        </div>
      </header>

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <Card class="gap-5 rounded-2xl p-5 shadow-sm sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="flex items-center gap-2 text-lg font-semibold"><ScanLine class="size-5" aria-hidden="true" />Quét mã QR</h2>
            <Button variant="outline" :aria-pressed="cameraEnabled" @click="toggleCamera"><Camera class="size-4" aria-hidden="true" />{{ cameraEnabled ? 'Tắt camera' : 'Bật camera' }}</Button>
          </div>
          <div v-if="cameraEnabled" class="overflow-hidden rounded-xl bg-black">
            <QrcodeStream @detect="detect" @error="handleCameraError" />
          </div>
          <p v-else class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Bật camera và đưa mã QR vào khung hình, hoặc nhập mã bên dưới.</p>
          <p v-if="cameraError" role="alert" class="text-sm text-danger">{{ cameraError }} Bạn có thể dùng ô nhập mã tay.</p>
          <form class="space-y-3 border-t pt-5" @submit.prevent="checkCode(manualCode)">
            <Label for="qr-code">Nhập mã vé thủ công</Label>
            <Input id="qr-code" v-model="manualCode" placeholder="Nhập hoặc dán mã QR của vé" autocomplete="off" />
            <Button type="submit" class="w-full" :disabled="submitting || !manualCode.trim()">{{ submitting ? 'Đang kiểm tra...' : 'Kiểm tra' }}</Button>
          </form>
        </Card>

        <div class="space-y-6">
          <p v-if="submitting" role="status" class="font-medium">Đang kiểm tra vé...</p>
          <section aria-live="polite" aria-atomic="true">
            <Card v-if="latest" class="gap-3 rounded-2xl border-2 p-6 shadow-sm" :class="resultClass(latest)">
              <h2 class="break-words text-2xl font-bold sm:text-3xl">{{ title(latest) }}</h2>
              <p class="break-words">{{ latest.message }}</p>
              <template v-if="latest.ticket">
                <p v-if="latest.ticket.ticketTypeName" class="break-words text-lg font-semibold">Loại vé: {{ latest.ticket.ticketTypeName }}</p>
                <p v-if="latest.ticket.holderName" class="break-words text-lg">Người mua: {{ latest.ticket.holderName }}</p>
                <p v-if="latest.result === 'WRONG_EVENT'" class="break-words font-semibold">Sự kiện của vé: {{ latest.ticket.eventTitle }}</p>
              </template>
            </Card>
            <Card v-else class="rounded-2xl border-dashed p-8 text-center text-muted-foreground">Kết quả kiểm tra vé sẽ hiển thị tại đây.</Card>
          </section>
          <Card class="gap-4 rounded-2xl p-5 shadow-sm sm:p-6">
            <h2 class="text-lg font-semibold">10 lượt quét gần nhất</h2>
            <p v-if="!history.length" class="text-sm text-muted-foreground">Chưa có lượt kiểm tra nào.</p>
            <ol v-else class="space-y-3">
              <li v-for="scan in history" :key="scan.id" class="space-y-1 rounded-xl border-l-4 p-3" :class="resultClass(scan)">
                <p class="break-words font-semibold">{{ title(scan) }}</p>
                <p class="break-words text-sm">{{ scan.message }}</p>
                <p v-if="scan.ticket" class="break-words text-sm">{{ scan.ticket.ticketTypeName }} · {{ scan.ticket.holderName }}<span v-if="scan.result === 'WRONG_EVENT'"> · {{ scan.ticket.eventTitle }}</span></p>
                <p class="text-xs">{{ formatDateTime(scan.scannedAt) }}</p>
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  </main>
</template>
