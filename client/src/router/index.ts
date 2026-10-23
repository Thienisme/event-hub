import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
  // BASE_URL để build ra sub-folder (nếu có) vẫn chạy đúng
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/events/:id',
      name: 'EventDetail',
      component: () => import('@/views/EventDetailView.vue'),
    },
    {
      path: '/events/create',
      name: 'CreateEvent',
      component: () => import('@/views/EventFormView.vue'),
      meta: { requiresAuth: true, organizerOnly: true },
    },
    {
      path: '/events/:id/edit',
      name: 'EditEvent',
      component: () => import('@/views/EventFormView.vue'),
      meta: { requiresAuth: true, organizerOnly: true },
    },
    {
      path: '/my-orders',
      name: 'MyOrders',
      component: () => import('@/views/MyOrdersView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // Quản lý sự kiện của bản thân (ORGANIZER / ADMIN)
      path: '/my-events',
      name: 'MyEvents',
      component: () => import('@/views/ManageEventsView.vue'),
      meta: { requiresAuth: true, organizerOnly: true },
    },
    {
      // Tổng quan hệ thống (chỉ ADMIN)
      path: '/admin',
      name: 'AdminDashboard',
      component: () => import('@/views/AdminDashboardView.vue'),
      meta: { requiresAuth: true, adminOnly: true },
    },
    {
      // Quản trị người dùng (chỉ ADMIN)
      path: '/admin/users',
      name: 'AdminUsers',
      component: () => import('@/views/AdminUsersView.vue'),
      meta: { requiresAuth: true, adminOnly: true },
    },
    {
      // Nhật ký thao tác quản trị (chỉ ADMIN)
      path: '/admin/audit-logs',
      name: 'AdminAuditLogs',
      component: () => import('@/views/AdminAuditView.vue'),
      meta: { requiresAuth: true, adminOnly: true },
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { guestOnly: true },
    },
    {
      // Bắt mọi đường dẫn không khớp -> tránh màn hình trắng
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
});

// Guard kiểm tra quyền truy cập
// Dùng kiểu `return` thay vì `next(...)`: đây là cách vue-router khuyến nghị,
// `next` chỉ còn được giữ lại để tương thích ngược và sẽ bị xóa ở bản sau.
router.beforeEach((to) => {
  const authStore = useAuthStore();

  // Route yêu cầu đăng nhập -> nhớ đường dẫn đang vào để quay lại sau khi login
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'Login', query: { redirect: to.fullPath } };
  }

  // Đã đăng nhập mà cố vào /login hoặc /register -> chuyển về Home
  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return { name: 'Home' };
  }

  // Route yêu cầu quyền organizer/admin
  if (to.meta.organizerOnly && authStore.isAuthenticated && !authStore.isOrganizer) {
    return { name: 'Home' };
  }

  // Route yêu cầu quyền ADMIN.
  // Kiểm tra sau `organizerOnly` vì ADMIN cũng là organizer: cần chặn đúng
  // người không đủ quyền mà không đụng vào người đã đăng nhập hợp lệ.
  if (to.meta.adminOnly && authStore.isAuthenticated && !authStore.isAdmin) {
    return { name: 'Home' };
  }

  return true;
});

export default router;
