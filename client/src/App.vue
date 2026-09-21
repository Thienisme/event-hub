<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

// Ẩn thanh điều hướng ở các trang auth (đăng nhập / đăng ký)
const showNavbar = computed(() => route.name !== 'Login' && route.name !== 'Register');

const handleLogout = () => {
  authStore.logout();
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

          <span v-if="authStore.user" class="text-sm text-gray-600">
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
  </div>
</template>
