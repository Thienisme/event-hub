<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CreditCard, Wallet, FlaskConical, CalendarDays, MapPin, Timer, LockKeyhole } from '@lucide/vue';
import { useOrderStore, type Order, type PaymentProvider } from '@/stores/order';
import { useToastStore } from '@/stores/toast';
import { formatPrice, formatDateTime } from '@/utils/format';
import DataState from '@/components/DataState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
const route = useRoute();
const router = useRouter();
const store = useOrderStore();
const toast = useToastStore();
const order = ref<Order | null>(null);
const loading = ref(true);
const loadError = ref('');
const providers = ref<PaymentProvider[]>([]);
const selected = ref<PaymentProvider>();
const busy = ref(false);
const promoBusy = ref(false);
const promoOpen = ref(false);
const promoInput = ref('');
const promoError = ref('');
const cancelOpen = ref(false);
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(timer));
const event = computed(() => order.value?.tickets[0]?.ticketType?.event);
const eventRoute = computed(() => event.value?.slug ? { name: 'EventDetail', params: { id: event.value.slug } } : { name: 'Home' });
const free = computed(() => Number(order.value?.totalAmount) === 0);
const remaining = computed(() => Math.max(0, Math.ceil((Date.parse(order.value?.expiresAt ?? '') - now.value) / 1000)) || 0);
const countdown = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`);
const locked = computed(() => busy.value || promoBusy.value || !remaining.value || order.value?.status !== 'PENDING');
const lines = computed(() => {
  const grouped = new Map<string, { id: string; name: string; quantity: number; price: number }>();
  for (const ticket of order.value?.tickets ?? []) {
    const line = grouped.get(ticket.ticketTypeId);
    if (line) line.quantity++;
    else grouped.set(ticket.ticketTypeId, { id: ticket.ticketTypeId, name: ticket.ticketType?.name ?? 'Loại vé', quantity: 1, price: Number(ticket.ticketType?.price ?? 0) });
  }
  return [...grouped.values()];
});
const methods = {
  VNPAY: { name: 'VNPay', description: 'Thẻ ATM nội địa, QR ngân hàng, thẻ quốc tế', icon: CreditCard },
  MOMO: { name: 'Ví MoMo', description: 'Quét mã bằng ứng dụng MoMo', icon: Wallet },
  MOCK: { name: 'Thanh toán thử', description: 'Chỉ dùng cho môi trường demo, không trừ tiền', icon: FlaskConical },
};
const message = (error: any, fallback: string): string => error?.response?.data?.message || fallback;
async function refreshOrder() {
  if (!order.value) return;
  order.value = await store.fetchOrder(order.value.id);
  if (order.value.status === 'CONFIRMED') await router.replace({ name: 'MyOrders' });
}
let version = 0;
async function load() {
  const currentVersion = ++version;
  loading.value = true;
  loadError.value = '';
  order.value = null;
  promoOpen.value = false;
  promoInput.value = '';
  promoError.value = '';
  cancelOpen.value = false;
  try {
    const [current, enabled] = await Promise.all([store.fetchOrder(String(route.params.orderId)), store.loadPaymentProviders()]);
    if (currentVersion !== version) return;
    order.value = current;
    providers.value = enabled;
    selected.value = enabled[0];
    if (current.status === 'CONFIRMED') await router.replace({ name: 'MyOrders' });
  } catch (error) {
    if (currentVersion === version) loadError.value = message(error, 'Không tải được thông tin thanh toán!');
  } finally {
    if (currentVersion === version) loading.value = false;
  }
}
watch(() => route.params.orderId, load, { immediate: true });
async function changePromo(remove = false) {
  if (locked.value || order.value?.paymentStarted || !order.value) return;
  promoError.value = '';
  if (!remove && !promoInput.value.trim()) { promoError.value = 'Nhập mã giảm giá trước khi áp dụng!'; return; }
  promoBusy.value = true;
  try {
    order.value = remove ? await store.removePromo(order.value.id) : await store.applyPromo(order.value.id, promoInput.value.trim().toUpperCase());
    promoInput.value = '';
  } catch (error: any) {
    promoError.value = message(error, 'Không thể cập nhật mã giảm giá!');
    if (error.response?.status === 409) await refreshOrder().catch(() => {});
  } finally { promoBusy.value = false; }
}
async function pay() {
  if (locked.value || !order.value || (!free.value && !selected.value)) return;
  busy.value = true;
  let redirecting = false;
  try {
    const provider = free.value ? providers.value.find(p => p !== 'MOCK') : selected.value;
    if (!provider || provider === 'MOCK') await store.confirmOrder(order.value.id);
    else {
      const response = await store.payOrder(order.value.id, provider);
      order.value.paymentStarted = true;
      if (response.data.paymentUrl) {
        window.location.href = response.data.paymentUrl;
        redirecting = true;
        return;
      }
      if (!response.data.order) throw new Error('Thiếu kết quả thanh toán');
    }
    toast.success('Thanh toán thành công');
    await router.push({ name: 'MyOrders' });
  } catch (error) {
    toast.error(message(error, 'Không tạo được phiên thanh toán, vui lòng thử lại!'));
    await refreshOrder().catch(() => {});
  } finally { if (!redirecting) busy.value = false; }
}
async function cancel() {
  if (busy.value || promoBusy.value || !order.value) return;
  busy.value = true;
  try {
    await store.cancelOrder(order.value.id);
    toast.success('Đã huỷ đơn hàng');
    await router.push(eventRoute.value);
  } catch (error) {
    toast.error(message(error, 'Huỷ đơn thất bại, vui lòng thử lại!'));
    await refreshOrder().catch(() => {});
  } finally { busy.value = false; cancelOpen.value = false; }
}
</script>

<template>
  <main class="min-h-screen bg-surface py-8 text-foreground sm:py-12">
    <div class="mx-auto max-w-6xl space-y-8 px-4 sm:px-6">
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">Thanh toán</h1>
      <DataState :loading="loading" :error="loadError" error-title="Không tải được đơn hàng" @retry="load">
        <template v-if="order">
          <div v-if="order.status === 'CANCELLED' || order.status === 'EXPIRED'" role="status" class="space-y-5 rounded-lg border border-border bg-background p-6 text-center">
            <p>{{ order.status === 'CANCELLED' ? 'Đơn hàng đã bị huỷ.' : 'Đơn hàng đã hết hạn giữ vé.' }}</p>
            <Button @click="router.push({ name: 'Home' })">Về trang chủ</Button>
          </div>
          <div v-else-if="order.status === 'PENDING'" class="grid min-w-0 items-start gap-8 lg:grid-cols-[1fr_380px]">
            <section class="order-2 min-w-0 space-y-5 lg:order-1" aria-labelledby="payment-heading">
              <h2 id="payment-heading" class="text-xl font-bold tracking-tight sm:text-2xl">Phương thức thanh toán</h2>
              <p v-if="free" class="rounded-lg border border-border bg-background p-5 text-sm leading-6">Đơn được miễn phí, bấm xác nhận để nhận vé</p>
              <div v-else role="radiogroup" aria-labelledby="payment-heading" class="space-y-3">
                <label v-for="provider in providers" :key="provider" class="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-5 transition-colors focus-within:ring-2 focus-within:ring-ring" :class="selected === provider ? 'border-primary bg-muted' : 'border-border bg-background'">
                  <input v-model="selected" type="radio" name="payment-provider" :value="provider" :disabled="busy || promoBusy" class="mt-1 size-4 shrink-0 accent-primary" />
                  <component :is="methods[provider].icon" class="mt-1 size-4 shrink-0" aria-hidden="true" />
                  <span class="min-w-0"><span class="block font-semibold">{{ methods[provider].name }}</span><span class="mt-1 block break-words text-sm leading-6 text-muted-foreground">{{ methods[provider].description }}</span></span>
                </label>
                <p v-if="!providers.length" role="alert" class="text-sm text-danger">Hiện chưa có cổng thanh toán khả dụng. Vui lòng thử lại sau.</p>
              </div>
            </section>
            <aside class="order-1 min-w-0 space-y-5 lg:order-2" aria-labelledby="summary-heading">
              <Card class="min-w-0 gap-5 border border-border bg-background p-5 shadow-none ring-0 sm:p-6">
                <h2 id="summary-heading" class="text-xl font-bold tracking-tight">Tóm tắt đơn</h2>
                <div class="min-w-0 space-y-2">
                  <h3 class="break-words font-semibold">{{ event?.title ?? 'Sự kiện' }}</h3>
                  <p class="flex items-start gap-2 text-sm text-muted-foreground"><CalendarDays class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{{ formatDateTime(event?.startTime) }}</span></p>
                  <p class="flex min-w-0 items-start gap-2 text-sm text-muted-foreground"><MapPin class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span class="min-w-0 break-words">{{ event?.location }}</span></p>
                </div>
                <div class="space-y-3 border-t border-border pt-5">
                  <div v-for="line in lines" :key="line.id" class="flex flex-wrap justify-between gap-2 text-sm"><span class="min-w-0 break-words">{{ line.name }} × {{ line.quantity }}</span><span class="ml-auto tabular-nums">{{ formatPrice(line.price * line.quantity) }}</span></div>
                  <div class="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm"><span>Tạm tính</span><span class="tabular-nums">{{ formatPrice(order.subtotalAmount ?? order.totalAmount) }}</span></div>
                </div>
                <div class="min-w-0 space-y-3">
                  <div v-if="order.promoCode" class="flex flex-wrap items-center gap-2"><span class="max-w-full break-all rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold">{{ order.promoCode }}</span><Button v-if="!order.paymentStarted" variant="ghost" size="sm" :disabled="locked" @click="changePromo(true)">Gỡ</Button></div>
                  <template v-if="!order.paymentStarted">
                    <button v-if="!promoOpen" type="button" class="text-sm underline underline-offset-4 disabled:opacity-50" :disabled="locked" :aria-expanded="promoOpen" aria-controls="promo-form" @click="promoOpen = true">Có mã giảm giá?</button>
                    <form v-else id="promo-form" class="space-y-2" @submit.prevent="changePromo()">
                      <label for="checkout-promo" class="text-sm font-medium">Mã giảm giá</label>
                      <div class="flex min-w-0 gap-2"><Input id="checkout-promo" v-model="promoInput" type="text" autocomplete="off" maxlength="32" class="min-w-0 flex-1 uppercase" :disabled="locked" :aria-invalid="!!promoError" :aria-describedby="promoError ? 'promo-error' : undefined" /><Button type="submit" variant="outline" :disabled="locked">Áp dụng</Button></div>
                    </form>
                  </template>
                  <p v-if="promoError" id="promo-error" role="alert" class="break-words text-sm text-danger">{{ promoError }}</p>
                  <div v-if="Number(order.discountAmount) > 0" class="flex flex-wrap justify-between gap-2 text-sm"><span>Giảm giá</span><span class="tabular-nums">−{{ formatPrice(order.discountAmount) }}</span></div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5"><span class="font-semibold">Tổng cộng</span><span class="text-2xl font-bold text-brand tabular-nums">{{ formatPrice(order.totalAmount) }}</span></div>
              </Card>
              <div class="space-y-3 text-center">
                <p class="flex items-center justify-center gap-2 text-sm"><Timer class="size-4 shrink-0" aria-hidden="true" /><span v-if="remaining > 0">Vé được giữ trong <strong class="tabular-nums">{{ countdown }}</strong></span><span v-else role="status">Hết thời gian giữ vé</span></p>
                <Button v-if="remaining === 0" variant="outline" class="w-full" @click="router.push(eventRoute)">Chọn lại vé</Button>
                <Button class="h-auto min-h-11 w-full whitespace-normal bg-brand py-3 text-brand-foreground hover:bg-brand/90" :disabled="locked || (!free && !selected)" @click="pay">{{ busy ? 'Đang chuyển tới cổng thanh toán...' : free ? 'Xác nhận nhận vé' : `Thanh toán ${formatPrice(order.totalAmount)}` }}</Button>
                <p class="flex items-start justify-center gap-1.5 text-xs leading-5 text-muted-foreground"><LockKeyhole class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Thanh toán được bảo mật bởi cổng thanh toán</span></p>
                <Button variant="link" :disabled="busy || promoBusy" @click="cancelOpen = true">Huỷ đơn</Button>
              </div>
            </aside>
          </div>
        </template>
      </DataState>
    </div>
    <ConfirmDialog :open="cancelOpen" title="Huỷ đơn hàng?" message="Vé sẽ được trả lại cho sự kiện. Bạn không thể thanh toán đơn này nữa." confirm-label="Huỷ đơn" cancel-label="Giữ lại" danger :loading="busy" @cancel="cancelOpen = false" @confirm="cancel" />
  </main>
</template>
