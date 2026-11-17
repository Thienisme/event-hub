<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search } from '@lucide/vue';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const route = useRoute();
const router = useRouter();
const search = ref('');
const location = ref('');
const cities = ['Hà Nội', 'TP.HCM', 'Đà Nẵng'];
watch(() => route.query, query => {
  const read = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };
  search.value = route.name === 'Home' ? read('search') : '';
  location.value = route.name === 'Home' ? read('location') : '';
}, { immediate: true });
function submit() {
  const term = search.value.trim();
  router.push({ name: 'Home', query: { ...(term && { search: term }), ...(location.value && { location: location.value }) } });
}
</script>

<template>
  <form role="search" aria-label="Tìm sự kiện" class="flex h-10 min-w-0 items-center rounded-md bg-muted" @submit.prevent="submit">
    <Select :model-value="location || 'all'" @update:model-value="value => { location = String(value) === 'all' ? '' : String(value); submit(); }">
      <SelectTrigger aria-label="Thành phố" class="h-10 w-28 shrink-0 rounded-r-none border-0 border-r border-border bg-transparent px-2 shadow-none md:w-36 lg:w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Toàn quốc</SelectItem>
        <SelectItem v-for="city in cities" :key="city" :value="city">{{ city }}</SelectItem>
        <SelectItem v-if="location && !cities.includes(location)" :value="location">{{ location }}</SelectItem>
      </SelectContent>
    </Select>
    <Search class="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <input v-model="search" type="search" aria-label="Từ khoá tìm kiếm" placeholder="Tìm sự kiện, nghệ sĩ, địa điểm..." class="h-full w-full min-w-0 rounded-md bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  </form>
</template>
