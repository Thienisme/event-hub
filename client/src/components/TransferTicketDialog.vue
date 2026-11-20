<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AlertCircle, Send } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useOrderStore } from '../stores/order';
import { useToastStore } from '../stores/toast';

/**
 * Chuyển một vé cho tài khoản khác theo email. Hai bước: nhập email -> xác nhận,
 * vì chuyển xong mã QR của người chuyển chết ngay và không tự lấy lại được.
 */
const props = defineProps<{
  /** Vé đang chuyển; null = đóng hộp thoại. */
  ticket: { id: string; label: string } | null;
}>();
const emit = defineEmits<{ close: [] }>();

const orderStore = useOrderStore();
const toast = useToastStore();

const email = ref('');
const step = ref<'input' | 'confirm'>('input');
const sending = ref(false);
const errorMessage = ref('');

const trimmedEmail = computed(() => email.value.trim());
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail.value));

watch(() => props.ticket?.id, () => {
  email.value = '';
  step.value = 'input';
  errorMessage.value = '';
  sending.value = false;
});

const next = () => {
  errorMessage.value = '';
  if (!emailValid.value) {
    errorMessage.value = 'Vui lòng nhập email hợp lệ của người nhận.';
    return;
  }
  step.value = 'confirm';
};

const submit = async () => {
  if (!props.ticket || sending.value) return;
  sending.value = true;
  errorMessage.value = '';
  try {
    const result = await orderStore.transferTicket(props.ticket.id, trimmedEmail.value);
    toast.success(`Đã chuyển vé cho ${result.toUser.fullName}`);
    emit('close');
  } catch (error: any) {
    errorMessage.value = error.response?.data?.message || 'Không thể chuyển vé. Vui lòng thử lại.';
    step.value = 'input';
  } finally {
    sending.value = false;
  }
};

const onOpenChange = (open: boolean) => {
  if (!open && !sending.value) emit('close');
};
</script>

<template>
  <Dialog :open="ticket !== null" @update:open="onOpenChange">
    <DialogContent class="max-w-md">
      <template v-if="ticket">
        <DialogHeader>
          <DialogTitle class="break-words pr-6">Chuyển vé · {{ ticket.label }}</DialogTitle>
          <DialogDescription>Người nhận cần có tài khoản EventHub với email này.</DialogDescription>
        </DialogHeader>

        <p class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm leading-relaxed">
          Sau khi chuyển, mã QR hiện tại của bạn sẽ mất hiệu lực ngay và bạn không lấy lại được vé (trừ khi người nhận chuyển lại).
        </p>

        <div v-if="errorMessage" role="alert" class="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span class="break-words">{{ errorMessage }}</span>
        </div>

        <form v-if="step === 'input'" class="space-y-4" novalidate @submit.prevent="next">
          <div class="space-y-2">
            <Label for="transfer-email">Email người nhận</Label>
            <Input id="transfer-email" v-model="email" type="email" autocomplete="email" inputmode="email" placeholder="ban@example.com" />
          </div>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" @click="emit('close')">Huỷ</Button>
            <Button type="submit">Tiếp tục</Button>
          </div>
        </form>

        <div v-else class="space-y-4">
          <p class="break-words text-sm">Chuyển vé cho <strong class="font-semibold">{{ trimmedEmail }}</strong>?</p>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" :disabled="sending" @click="step = 'input'">Quay lại</Button>
            <Button type="button" :disabled="sending" @click="submit">
              <Send class="size-4" aria-hidden="true" />{{ sending ? 'Đang chuyển...' : 'Xác nhận chuyển' }}
            </Button>
          </div>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
