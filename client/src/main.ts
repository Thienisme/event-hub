import { createApp } from 'vue';
import { createPinia } from 'pinia';
// Phải import ở đây, nếu không Tailwind sẽ không được nạp
// -> mọi class trong template đều vô tác dụng và UI trở về HTML thô.
import './style.css';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import { useToastStore } from './stores/toast';
import {
  setSessionExpiredHandler,
  setAccountBlockedHandler,
  setPermissionChangedHandler,
} from './api/session';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const authStore = useAuthStore();
const toastStore = useToastStore();

// Token hết hạn -> dọn state và đưa user về trang đăng nhập, kèm đường dẫn
// đang xem để sau khi đăng nhập lại quay về đúng chỗ.
// Handler được đăng ký ở đây (ngoài axios) để không tạo vòng import
// router -> stores/auth -> api/axios -> router.
setSessionExpiredHandler(() => {
  authStore.logout();

  const current = router.currentRoute.value;
  // Đã ở trang đăng nhập/đăng ký rồi thì không điều hướng lại, tránh loop.
  if (current.name === 'Login' || current.name === 'Register') return;

  router.push({ name: 'Login', query: { redirect: current.fullPath } });
});

// Tài khoản bị khoá -> mọi API đều 403. Đưa user về trang đăng nhập và báo rõ
// lý do, thay vì để app rơi vào trạng thái "mọi nút bấm đều lỗi".
setAccountBlockedHandler((message) => {
  authStore.logout();

  const current = router.currentRoute.value;
  if (current.name === 'Login' || current.name === 'Register') {
    toastStore.error(message);
    return;
  }

  router.push({ name: 'Login', query: { redirect: current.fullPath } });
  toastStore.error(message);
});

// Quyền vừa bị đổi (admin hạ quyền) -> lấy lại profile để navbar và các menu
// cập nhật theo role mới, thay vì vẫn hiển thị quyền cũ.
setPermissionChangedHandler(() => {
  authStore.fetchProfile();
});

// `token` được lưu ở localStorage nên sống qua F5, nhưng `user` chỉ nằm trong RAM.
// Không gọi lại /auth/me thì sau khi refresh app sẽ "tưởng" mình đã đăng nhập
// nhưng user = null -> navbar mất tên, isOrganizer sai.
if (authStore.token) {
  authStore.fetchProfile();
}

app.mount('#app');
