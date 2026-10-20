import { createApp } from 'vue';
import { createPinia } from 'pinia';
// Phải import ở đây, nếu không Tailwind sẽ không được nạp
// -> mọi class trong template đều vô tác dụng và UI trở về HTML thô.
import './style.css';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import { setSessionExpiredHandler } from './api/session';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const authStore = useAuthStore();

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

// `token` được lưu ở localStorage nên sống qua F5, nhưng `user` chỉ nằm trong RAM.
// Không gọi lại /auth/me thì sau khi refresh app sẽ "tưởng" mình đã đăng nhập
// nhưng user = null -> navbar mất tên, isOrganizer sai.
if (authStore.token) {
  authStore.fetchProfile();
}

app.mount('#app');
