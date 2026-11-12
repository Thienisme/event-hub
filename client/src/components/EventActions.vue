<script setup lang="ts">
import { computed } from 'vue';
import type { EventItem } from '../stores/event';
import { useToastStore } from '../stores/toast';
import { buildIcsContent, downloadIcs, googleCalendarUrl } from '../utils/calendar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar, Download, MapPin, Share2 } from '@lucide/vue';

const props = defineProps<{
  event: EventItem;
}>();

const toastStore = useToastStore();

const mapUrl = computed(
  () => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(props.event.location)}`
);

const handleAddToGoogleCalendar = () => {
  window.open(googleCalendarUrl(props.event), '_blank', 'noopener,noreferrer');
};

const handleDownloadIcs = () => {
  const content = buildIcsContent(props.event);
  downloadIcs(content, props.event.title);
};

const handleShare = async () => {
  const { title } = props.event;
  const url = window.location.href;

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error: any) {
      // Người dùng huỷ chia sẻ -> bỏ qua. Lỗi khác thì chuyển sang sao chép link.
      if (error?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    toastStore.info('Đã sao chép liên kết');
  } catch {
    toastStore.error('Sao chép liên kết thất bại');
  }
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" aria-label="Thêm sự kiện vào lịch">
          <Calendar />Thêm vào lịch
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-64">
        <DropdownMenuItem class="flex items-center gap-2" @click="handleAddToGoogleCalendar">
          <Calendar class="size-4" />Google Calendar
        </DropdownMenuItem>
        <DropdownMenuItem class="flex items-center gap-2" @click="handleDownloadIcs">
          <Download class="size-4" />Tải file .ics
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      as-child
      variant="outline"
      aria-label="Xem bản đồ sự kiện trên Google Maps"
    >
      <a :href="mapUrl" target="_blank" rel="noopener noreferrer">
        <MapPin />Xem bản đồ
      </a>
    </Button>
    <Button
      variant="outline"
      aria-label="Chia sẻ liên kết sự kiện"
      @click="handleShare"
    >
      <Share2 />Chia sẻ
    </Button>
  </div>
</template>
