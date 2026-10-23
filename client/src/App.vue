<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import AppToast from './components/AppToast.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

// Ẩn thanh điều hướng ở các trang auth (đăng nhập / đăng ký)
const showNavbar = computed(() => route.name !== 'Login' && route.name !== 'Register');

// Menu ngữ cảnh: đóng lại khi bấm ra ngoài hoặc bấm vào mục khác.
const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

const closeMenu = (event: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
};

onMounted(() => document.addEventListener('click', closeMenu));
onUnmounted(() => document.removeEventListener('click', closeMenu));

const handleLogout = () => {
  authStore.logout();
  menuOpen.value = false;
  router.push({ name: 'Login' });
};
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Thanh điều hướng dùng chung -->
    <header
      v-if="showNavbar"
      class="bg-white border-b border-gray-200 sticky top-0 z-10"
    >
      <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <router-link :to="{ name: 'Home' }" class="text-xl font-extrabold text-gray-900">
          Event<span class="text-indigo-600">Hub</span>
        </router-link>

        <div class="flex items-center gap-4">
          <router-link
            v-if="authStore.isAuthenticated"
            :to="{ name: 'MyOrders' }"
            class="text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors"
          >
            Vé của tôi
          </router-link>

          <!-- Menu theo vai trò -->
          <div v-if="authStore.isAuthenticated" ref="menuRef" class="relative">
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors"
              aria-haspopup="menu"
              :aria-expanded="menuOpen"
              @click.stop="menuOpen = !menuOpen"
            >
              Quản lý
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div
              v-if="menuOpen"
              role="menu"
              class="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20"
            >
              <router-link
                v-if="authStore.isOrganizer"
                :to="{ name: 'MyEvents' }"
                role="menuitem"
                class="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                @click="menuOpen = false"
              >
                Sự kiện của tôi
              </router-link>

              <router-link
                v-if="authStore.isOrganizer"
                :to="{ name: 'CreateEvent' }"
                role="menuitem"
                class="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                @click="menuOpen = false"
              >
                + Tạo sự kiện
              </router-link>

              <router-link
                v-if="authStore.isAdmin"
                :to="{ name: 'AdminDashboard' }"
                role="menuitem"
                class="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                @click="menuOpen = false"
              >
                Tổng quan quản trị
              </router-link>

              <router-link
                v-if="authStore.isAdmin"
                :to="{ name: 'AdminUsers' }"
                role="menuitem"
                class="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                @click="menuOpen = false"
              >
                Quản lý người dùng
              </router-link>
            </div>
          </div>

          <span v-if="authStore.user" class="hidden sm:inline text-sm text-gray-600">
            {{ authStore.user.fullName }}
          </span>

          <button
            v-if="authStore.isAuthenticated"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            @click="handleLogout"
          >
            Đăng xuất
          </button>

          <router-link
            v-else
            :to="{ name: 'Login' }"
            class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            Đăng nhập
          </router-link>
        </div>
      </nav>
    </header>

    <!-- Nơi router render component của route đang active -->
    <main class="flex-1">
      <RouterView />
    </main>

    <!-- Thông báo nổi, nằm ngoài luồng nội dung nên không làm đẩy layout -->
    <AppToast />
  </div>
</template>
