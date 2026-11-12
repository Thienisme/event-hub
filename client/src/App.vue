<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import apiClient from './api/axios';
import AppToast from './components/AppToast.vue';

const resendBusy = ref(false);
const resendMessage = ref('');
async function resendEmail() {
  resendBusy.value = true;
  try {
    const { data } = await apiClient.post('/auth/resend-verification');
    resendMessage.value = data.message;
    await authStore.fetchProfile();
  } catch (error: any) {
    resendMessage.value = error.response?.data?.message || 'Không thể gửi email. Vui lòng thử lại.';
  } finally { resendBusy.value = false; }
}
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
// Các trang tài khoản dùng bố cục tối giản, không có thanh menu (giống nhau cho cả 4 trang).
const AUTH_PAGES = new Set(['Login', 'Register', 'ForgotPassword', 'ResetPassword']);
const showNavbar = computed(() => !AUTH_PAGES.has(String(route.name)));
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
  ? 'text-foreground font-semibold'
  : 'text-muted-foreground hover:text-foreground';

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
  <div class="min-h-screen flex flex-col bg-surface">
    <header v-if="showNavbar" ref="headerRef" class="bg-background border-b border-border sticky top-0 z-10 px-4 sm:px-6 lg:px-8">
      <nav class="max-w-6xl mx-auto h-16 flex items-center justify-between gap-3">
        <router-link :to="{ name: 'Home' }" class="shrink-0 text-xl font-extrabold text-foreground">
          Event<span class="text-foreground">Hub</span>
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
              <button type="button" class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground" :aria-expanded="menuOpen" aria-controls="desktop-management" @click="menuOpen = !menuOpen">
                Quản lý
                <svg aria-hidden="true" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="menuOpen" id="desktop-management" class="absolute right-0 mt-2 w-56 bg-background border border-border rounded-lg shadow-xs py-1 z-20">
                <div v-for="(group, index) in menuGroups" :key="group.title" :class="index > 0 ? 'border-t border-border mt-1 pt-1' : ''">
                  <p class="px-4 py-2 text-xs uppercase text-muted-foreground">{{ group.title }}</p>
                  <router-link v-for="item in group.items" :key="item.name" :to="{ name: item.name }" class="block px-4 py-2.5 text-sm transition-colors" :class="linkClass(item.name)" @click="closeMenus">
                    {{ item.label }}
                  </router-link>
                </div>
              </div>
            </div>
            <div v-if="authStore.user" :title="authStore.user.role" class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground font-semibold">{{ initial }}</span>
              <span class="max-w-32 lg:max-w-56 truncate">{{ authStore.user.fullName }}</span>
            </div>
            <Button type="button" variant="outline" class="shrink-0 whitespace-nowrap" @click="handleLogout">Đăng xuất</Button>
          </template>
          <Button v-else as-child><router-link :to="{ name: 'Login' }" >Đăng nhập</router-link></Button>
        </div>

        <button v-if="authStore.isAuthenticated" type="button" class="md:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" :aria-label="mobileOpen ? 'Đóng menu' : 'Mở menu'" :aria-expanded="mobileOpen" aria-controls="mobile-navigation" @click="mobileOpen = !mobileOpen">
          <svg aria-hidden="true" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path v-if="mobileOpen" stroke-linecap="round" stroke-width="2" d="M6 6l12 12M6 18L18 6" />
            <path v-else stroke-linecap="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Button v-else as-child class="md:hidden shrink-0"><router-link :to="{ name: 'Login' }">Đăng nhập</router-link></Button>
      </nav>

      <div v-if="mobileOpen && authStore.isAuthenticated" id="mobile-navigation" class="md:hidden absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background px-4 py-3">
        <div class="flex min-w-0 items-center gap-3 border-b border-border pb-3 mb-2">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground font-semibold">{{ initial }}</span>
          <div class="min-w-0">
            <p class="break-words text-sm font-medium text-foreground">{{ authStore.user?.fullName }}</p>
            <p class="text-xs text-muted-foreground">{{ roleLabel }}</p>
          </div>
        </div>
        <router-link :to="{ name: 'MyOrders' }" class="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium" :class="linkClass('MyOrders')" @click="closeMenus">Vé của tôi</router-link>
        <router-link :to="{ name: 'Profile' }" class="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium" :class="linkClass('Profile')" @click="closeMenus">Hồ sơ</router-link>
        <div v-for="group in menuGroups" :key="group.title" class="mt-2 border-t border-border pt-2">
          <p class="px-3 py-2 text-xs uppercase text-muted-foreground">{{ group.title }}</p>
          <router-link v-for="item in group.items" :key="item.name" :to="{ name: item.name }" class="flex min-h-11 items-center rounded-lg px-3 text-sm" :class="linkClass(item.name)" @click="closeMenus">{{ item.label }}</router-link>
        </div>
        <button type="button" class="mt-3 flex min-h-11 w-full items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground" @click="handleLogout">Đăng xuất</button>
      </div>
    </header>

    <div v-if="authStore.isAuthenticated && authStore.user?.emailVerifiedAt === null" class="border-b border-border bg-muted px-4 py-3 text-sm">
      <div class="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
        <span>Email chưa được xác minh</span>
        <Button variant="outline" size="sm" :disabled="resendBusy" @click="resendEmail">{{ resendBusy ? 'Đang gửi...' : 'Gửi lại email' }}</Button>
        <span role="status" class="text-muted-foreground">{{ resendMessage }}</span>
      </div>
    </div>
    <main class="flex-1">
      <RouterView />
    </main>
    <footer v-if="showNavbar" class="border-t border-border bg-background px-4 sm:px-6 lg:px-8">
      <div class="max-w-6xl mx-auto">
        <div class="py-12 grid gap-10 grid-cols-2 md:grid-cols-5">
          <div class="col-span-2">
            <p class="text-xl font-extrabold">EventHub</p>
            <p class="mt-4 text-sm text-muted-foreground max-w-xs">Nền tảng khám phá và đặt vé sự kiện: hoà nhạc, hội thảo, workshop và hơn thế nữa.</p>
          </div>
          <div>
            <h2 class="text-sm font-semibold">Khám phá</h2>
            <ul class="mt-4 space-y-3 text-sm">
              <li><router-link to="/" class="text-muted-foreground hover:text-foreground transition-colors">Sự kiện sắp diễn ra</router-link></li>
              <li><router-link to="/?category=MUSIC" class="text-muted-foreground hover:text-foreground transition-colors">Âm nhạc</router-link></li>
              <li><router-link to="/?category=CONFERENCE" class="text-muted-foreground hover:text-foreground transition-colors">Hội thảo</router-link></li>
              <li><router-link to="/?category=WORKSHOP" class="text-muted-foreground hover:text-foreground transition-colors">Workshop</router-link></li>
              <li><router-link to="/?status=ended" class="text-muted-foreground hover:text-foreground transition-colors">Sự kiện đã kết thúc</router-link></li>
            </ul>
          </div>
          <div>
            <h2 class="text-sm font-semibold">Ban tổ chức</h2>
            <ul class="mt-4 space-y-3 text-sm">
              <li><router-link to="/events/create" class="text-muted-foreground hover:text-foreground transition-colors">Tạo sự kiện</router-link></li>
              <li><router-link to="/my-events" class="text-muted-foreground hover:text-foreground transition-colors">Quản lý sự kiện</router-link></li>
              <li><router-link to="/faq#ban-to-chuc" class="text-muted-foreground hover:text-foreground transition-colors">Câu hỏi cho ban tổ chức</router-link></li>
            </ul>
          </div>
          <div>
            <h2 class="text-sm font-semibold">Hỗ trợ</h2>
            <ul class="mt-4 space-y-3 text-sm">
              <li><router-link to="/faq" class="text-muted-foreground hover:text-foreground transition-colors">Câu hỏi thường gặp</router-link></li>
              <li><router-link to="/terms" class="text-muted-foreground hover:text-foreground transition-colors">Điều khoản sử dụng</router-link></li>
              <li><router-link to="/privacy" class="text-muted-foreground hover:text-foreground transition-colors">Chính sách bảo mật</router-link></li>
            </ul>
          </div>
        </div>
        <div class="border-t border-border py-6 flex flex-col sm:flex-row gap-3 justify-between text-xs text-muted-foreground">
          <p>© {{ currentYear }} EventHub. Dự án demo, thanh toán là giả lập.</p>
          <p>Giờ hiển thị theo múi giờ Việt Nam (GMT+7)</p>
        </div>
      </div>
    </footer>
    <AppToast />
  </div>
</template>
