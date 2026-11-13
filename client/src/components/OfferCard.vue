<script setup lang="ts">
import { Check } from '@lucide/vue';
import type { OrderOffer } from '@/stores/order';
import { offerLabel, offerMeta } from '@/utils/offers';
import { formatPrice } from '@/utils/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
defineProps<{ offer: OrderOffer; active: boolean; best: boolean; disabled: boolean }>();
defineEmits<{ apply: []; remove: [] }>();
</script>

<template>
  <div role="group" :aria-label="`Ưu đãi ${offer.code.toUpperCase()}, giảm ${Number(offer.discountAmount).toLocaleString('vi-VN')} đồng`" class="flex min-w-0 rounded-lg border bg-background" :class="active ? 'border-foreground' : 'border-border'">
    <div class="flex w-20 shrink-0 flex-col items-center justify-center rounded-l-lg bg-muted px-1 py-3">
      <span class="max-w-full break-words text-center text-lg font-extrabold tabular-nums">{{ offerLabel(offer).replace(/^Giảm /, '') }}</span>
      <span class="text-[10px] uppercase tracking-widest text-muted-foreground">Giảm</span>
    </div>
    <div class="relative min-w-0 flex-1 border-l border-dashed border-border p-3">
      <span aria-hidden="true" class="absolute -left-1.5 -top-1.5 size-3 rounded-full border border-border bg-background" />
      <span aria-hidden="true" class="absolute -bottom-1.5 -left-1.5 size-3 rounded-full border border-border bg-background" />
      <div class="flex flex-wrap items-center gap-1.5"><p class="min-w-0 break-words text-sm font-semibold">Giảm {{ formatPrice(offer.discountAmount) }}</p><Badge v-if="best" variant="outline">Tốt nhất</Badge></div>
      <p v-if="offerMeta(offer)" class="mt-1 text-xs text-muted-foreground">{{ offerMeta(offer) }}</p>
      <p class="mt-1 truncate font-mono text-xs uppercase" :title="offer.code">{{ offer.code }}</p>
      <div class="mt-2 flex flex-wrap items-center justify-end gap-1">
        <template v-if="active"><span class="inline-flex items-center gap-1 text-xs font-semibold"><Check class="size-4" aria-hidden="true" />Đang dùng</span><Button variant="ghost" size="sm" :disabled="disabled" @click="$emit('remove')">Gỡ</Button></template>
        <Button v-else variant="outline" size="sm" :disabled="disabled" @click="$emit('apply')">Áp dụng</Button>
      </div>
    </div>
  </div>
</template>
