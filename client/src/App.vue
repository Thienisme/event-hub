<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import AppToast from './components/AppToast.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const showNavbar = computed(() => route.name !== 'Login' && route.name !== 'Register');
const currentYear = new Date().getFullYear();
const initial = computed(() => Array.from(authStore.user?.fullName.trim() || '?')[0]?.toLocaleUpperCase('vi-VN'));
const roleLabel = computed(() => {
  switch (authStore.user?.role) {
    case 'ADMIN': return 'Quản trị viên';
    case 'ORGANIZER': return 'Nhà tổ chức';
    case 'CUSTOMER': return 'Khách hàng';
    default: return '';
  }
});
const menuGroups = computed(() => [
  ...(authStore.isOrganizer ? [{ title: 'Nhà tổ chức', items: [
    { name: 'MyEvents', label: 'Sự kiện của tôi' },
    { name: 'CreateEvent', label: '+ Tạo sự kiện' },
  ] }] : []),
  ...(authStore.isAdmin ? [{ title: 'Quản trị', items: [
    { name: 'AdminDashboard', label: 'Tổng quan' },
    { name: 'AdminUsers', label: 'Người dùng' },
    { name: 'AdminAuditLogs', label: 'Nhật ký' },
  ] }] : []),
]);
const linkClass = (name: string) => route.name === name
  ? 'text-indigo-600 bg-indigo-50'
  : 'text-gray-700 hover:bg-gray-50 hover:text-indigo-600';

const menuOpen = ref(false);
const mobileOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const headerRef = ref<HTMLElement | null>(null);
const closeMenus = () => {
  menuOpen.value = false;
  mobileOpen.value = false;
};
// Đóng menu khi đổi trang, bấm ra ngoài hoặc nhấn Escape.
watch(() => route.fullPath, closeMenus);
watch(() => authStore.isAuthenticated, closeMenus);
const handleOutsideClick = (event: MouseEvent) => {
  // Dùng composedPath() chứ không dùng contains(event.target): bấm nút hamburger
  // làm icon bên trong đổi (v-if), phần tử được bấm bị gỡ khỏi DOM trước khi
  // listener này chạy, nên contains() trả false và panel vừa mở bị đóng ngay.
  const path = event.composedPath();
  if (!menuRef.value || !path.includes(menuRef.value)) menuOpen.value = false;
  if (!headerRef.value || !path.includes(headerRef.value)) mobileOpen.value = false;
};
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeMenus();
};
onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handleKeydown);
});
const handleLogout = () => {
  authStore.logout();
  closeMenus();
  router.push({ name: 'Login' });
};
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gray-50">
    <header v-if="showNavbar" ref="headerRef" class="bg-white border-b border-gray-200 sticky top-0 z-10">
      <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <router-link :to="{ name: 'Home' }" class="shrink-0 text-xl font-extrabold text-gray-900">
          Event<span class="text-indigo-600">Hub</span>
        </router-link>

        <div class="hidden md:flex min-w-0 items-center gap-3 lg:gap-4">
          <template v-if="authStore.isAuthenticated">
            <router-link :to="{ name: 'MyOrders' }" class="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors" :class="linkClass('MyOrders')">
              Vé của tôi
            </router-link>
            <router-link :to="{ name: 'Profile' }" class="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors" :class="linkClass('Profile')">
              Hồ sơ
            </router-link>
            <div v-if="authStore.isOrganizer" ref="menuRef" class="relative shrink-0">
              <button type="button" class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 hover:text-indigo-600" :aria-expanded="menuOpen" aria-controls="desktop-management" @click="menuOpen = !menuOpen">
                Quản lý
                <svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="menuOpen" id="desktop-management" class="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20">
                <div v-for="(group, index) in menuGroups" :key="group.title" :class="index > 0 ? 'border-t border-gray-200 mt-1 pt-1' : ''">
                  <p class="px-4 py-2 text-xs uppercase text-gray-500">{{ group.title }}</p>
                  <router-link v-for="item in group.items" :key="item.name" :to="{ name: item.name }" class="block px-4 py-2.5 text-sm transition-colors" :class="linkClass(item.name)" @click="closeMenus">
                    {{ item.label }}
                  </router-link>
                </div>
              </div>
            </div>
            <div v-if="authStore.user" :title="authStore.user.role" class="flex min-w-0 items-center gap-2 text-sm text-gray-600">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-semibold">{{ initial }}</span>
              <span class="max-w-32 lg:max-w-56 truncate">{{ authStore.user.fullName }}</span>
            </div>
            <button type="button" class="shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg" @click="handleLogout">Đăng xuất</button>
          </template>
          <router-link v-else :to="{ name: 'Login' }" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">Đăng nhập</router-link>
        </div>

        <button v-if="authStore.isAuthenticated" type="button" class="md:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100" :aria-label="mobileOpen ? 'Đóng menu' : 'Mở menu'" :aria-expanded="mobileOpen" aria-controls="mobile-navigation" @click="mobileOpen = !mobileOpen">
          <svg aria-hidden="true" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path v-if="mobileOpen" stroke-linecap="round" stroke-width="2" d="M6 6l12 12M6 18L18 6" />
            <path v-else stroke-linecap="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <router-link v-else :to="{ name: 'Login' }" class="md:hidden shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Đăng nhập</router-link>
      </nav>

      <div v-if="mobileOpen && authStore.isAuthenticated" id="mobile-navigation" class="md:hidden absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-gray-200 bg-white px-4 py-3 shadow-lg">
        <div class="flex min-w-0 items-center gap-3 border-b border-gray-200 pb-3 mb-2">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-semibold">{{ initial }}</span>
          <div class="min-w-0">
            <p class="break-words text-sm font-medium text-gray-900">{{ authStore.user?.fullName }}</p>
            <p class="text-xs text-gray-500">{{ roleLabel }}</p>
          </div>
        </div>
        <router-link :to="{ name: 'MyOrders' }" class="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium" :class="linkClass('MyOrders')" @click="closeMenus">Vé của tôi</router-link>
        <router-link :to="{ name: 'Profile' }" class="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium" :class="linkClass('Profile')" @click="closeMenus">Hồ sơ</router-link>
        <div v-for="group in menuGroups" :key="group.title" class="mt-2 border-t border-gray-200 pt-2">
          <p class="px-3 py-2 text-xs uppercase text-gray-500">{{ group.title }}</p>
          <router-link v-for="item in group.items" :key="item.name" :to="{ name: item.name }" class="flex min-h-11 items-center rounded-lg px-3 text-sm" :class="linkClass(item.name)" @click="closeMenus">{{ item.label }}</router-link>
        </div>
        <button type="button" class="mt-3 flex min-h-11 w-full items-center rounded-lg bg-red-50 px-3 text-sm font-medium text-red-600 hover:bg-red-100" @click="handleLogout">Đăng xuất</button>
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>
    <footer v-if="showNavbar" class="border-t border-gray-200 px-4 py-5 text-center text-xs text-gray-500">
      © {{ currentYear }} EventHub · Nền tảng đặt vé sự kiện
    </footer>
    <AppToast />
  </div>
</template>
