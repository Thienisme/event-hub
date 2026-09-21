import { createApp } from 'vue';
import { createPinia } from 'pinia';
// Phải import ở đây, nếu không Tailwind sẽ không được nạp
// -> mọi class trong template đều vô tác dụng và UI trở về HTML thô.
import './style.css';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// `token` được lưu ở localStorage nên sống qua F5, nhưng `user` chỉ nằm trong RAM.
// Không gọi lại /auth/me thì sau khi refresh app sẽ "tưởng" mình đã đăng nhập
// nhưng user = null -> navbar mất tên, isOrganizer sai.
const authStore = useAuthStore();
if (authStore.token) {
  authStore.fetchProfile();
}

app.mount('#app');
