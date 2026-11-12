<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ChevronDown, LogOut, UserRound, Ticket, Menu, X } from '@lucide/vue';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import apiClient from './api/axios';
import UserAvatar from './components/UserAvatar.vue';
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
    { name: 'CreateEvent', label: 'Tạo sự kiện' },
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
    <a href="#main-content" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring">Đến nội dung chính</a>
    <header v-if="showNavbar" ref="headerRef" class="bg-background border-b border-border sticky top-0 z-10 px-4 sm:px-6 lg:px-8">
      <nav class="max-w-6xl mx-auto h-16 flex items-center justify-between gap-3">
        <router-link :to="{ name: 'Home' }" class="shrink-0 text-xl font-extrabold text-foreground">
          Event<span class="text-foreground">Hub</span>
        </router-link>

        <div class="hidden md:flex min-w-0 items-center gap-3 lg:gap-4">
          <template v-if="authStore.isAuthenticated">
            <router-link :to="{ name: 'MyOrders' }" class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" :class="linkClass('MyOrders')">
              <Ticket class="size-4" aria-hidden="true" />Vé của tôi
            </router-link>
            <DropdownMenu v-model:open="menuOpen">
              <DropdownMenuTrigger as-child>
                <button type="button" class="flex min-h-11 max-w-64 items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-muted" aria-label="Mở menu tài khoản">
                  <UserAvatar :name="authStore.user?.fullName" :url="authStore.user?.avatarUrl" class="size-9 text-sm" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-foreground">{{ authStore.user?.fullName || 'Tài khoản' }}</span>
                    <span class="block text-xs text-muted-foreground">{{ roleLabel }}</span>
                  </span>
                  <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': menuOpen }" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="8" class="w-64 shadow-xs">
                <DropdownMenuLabel class="px-3 py-3 font-normal">
                  <p class="truncate text-sm font-semibold">{{ authStore.user?.fullName || 'Tài khoản' }}</p>
                  <p class="mt-1 truncate text-xs text-muted-foreground">{{ authStore.user?.email }}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem as-child>
                  <router-link :to="{ name: 'Profile' }" class="min-h-10 cursor-pointer" :aria-current="route.name === 'Profile' ? 'page' : undefined">
                    <UserRound aria-hidden="true" />Hồ sơ cá nhân
                  </router-link>
                </DropdownMenuItem>
                <template v-for="group in menuGroups" :key="group.title">
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="px-2 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{{ group.title }}</DropdownMenuLabel>
                  <DropdownMenuItem v-for="item in group.items" :key="item.name" as-child>
                    <router-link :to="{ name: item.name }" class="min-h-10 cursor-pointer" :class="linkClass(item.name)" :aria-current="route.name === item.name ? 'page' : undefined">{{ item.label }}</router-link>
                  </DropdownMenuItem>
                </template>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="min-h-10 cursor-pointer" @select="handleLogout">
                  <LogOut aria-hidden="true" />Đăng xuất
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
          <Button v-else as-child><router-link :to="{ name: 'Login' }" >Đăng nhập</router-link></Button>
        </div>

        <button v-if="authStore.isAuthenticated" type="button" class="md:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" :aria-label="mobileOpen ? 'Đóng menu' : 'Mở menu'" :aria-expanded="mobileOpen" aria-controls="mobile-navigation" @click="mobileOpen = !mobileOpen">
          <X v-if="mobileOpen" class="size-5" aria-hidden="true" />
          <Menu v-else class="size-5" aria-hidden="true" />
        </button>
        <Button v-else as-child class="md:hidden shrink-0"><router-link :to="{ name: 'Login' }">Đăng nhập</router-link></Button>
      </nav>

      <div v-if="mobileOpen && authStore.isAuthenticated" id="mobile-navigation" class="md:hidden absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background px-4 py-3">
        <div class="flex min-w-0 items-center gap-3 border-b border-border pb-3 mb-2">
          <UserAvatar :name="authStore.user?.fullName" :url="authStore.user?.avatarUrl" class="size-10 text-sm" />
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
    <main id="main-content" tabindex="-1" class="flex-1">
      <RouterView />
    </main>
    <footer v-if="showNavbar" class="site-footer bg-primary text-primary-foreground px-4 sm:px-6 lg:px-8">
      <div class="max-w-6xl mx-auto">
        <div class="py-12 sm:py-16 grid gap-x-8 gap-y-10 grid-cols-2 md:grid-cols-5">
          <div class="col-span-2">
            <router-link to="/" class="inline-block text-3xl font-extrabold tracking-tight rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground">EventHub<span aria-hidden="true" class="text-primary-foreground/50">.</span></router-link>
            <p class="mt-4 text-sm text-primary-foreground/70 leading-6 max-w-xs">Nền tảng khám phá và đặt vé sự kiện: hoà nhạc, hội thảo, workshop và hơn thế nữa.</p>
            <p class="mt-6 border-l border-primary-foreground/30 pl-3 text-sm font-medium leading-6">Mỗi tấm vé, một trải nghiệm.</p>
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
        <div class="border-t border-primary-foreground/20 py-6 flex flex-col sm:flex-row gap-3 justify-between text-xs text-primary-foreground/60 leading-5">
          <p>© {{ currentYear }} EventHub. Dự án demo, thanh toán là giả lập.</p>
          <p>Giờ hiển thị theo múi giờ Việt Nam (GMT+7)</p>
        </div>
      </div>
    </footer>
    <AppToast />
  </div>
</template>

<style scoped>
@reference "./style.css";

.site-footer h2 {
  @apply text-xs font-semibold uppercase tracking-widest text-primary-foreground/90;
}

.site-footer li a {
  @apply inline-block rounded-sm text-primary-foreground/70 underline-offset-4 hover:text-primary-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground;
}
</style>
