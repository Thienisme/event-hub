<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/format';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const auth = useAuthStore();
const toast = useToastStore();
const loading = ref(true);
const fullName = ref('');
const savingName = ref(false);
const nameError = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const confirmation = ref('');
const savingPassword = ref(false);
const passwordError = ref('');
const nameUnchanged = computed(() => fullName.value.trim() === auth.user?.fullName);
const roleLabel = computed(() => auth.user ? {
  ADMIN: 'Quản trị viên', ORGANIZER: 'Nhà tổ chức', CUSTOMER: 'Khách hàng',
}[auth.user.role] : '—');
watch(() => auth.user?.fullName, (name) => { fullName.value = name ?? ''; }, { immediate: true });
async function loadProfile() {
  loading.value = true;
  try { await auth.fetchProfile(); } finally { loading.value = false; }
}
onMounted(loadProfile);
async function saveName() {
  if (savingName.value || !auth.user || nameUnchanged.value) return;
  nameError.value = '';
  const name = fullName.value.trim();
  if (name.length < 2 || name.length > 191) {
    nameError.value = 'Họ và tên phải có từ 2 đến 191 ký tự.';
    return;
  }
  savingName.value = true;
  try {
    await auth.updateProfile(name);
    fullName.value = auth.user.fullName;
    toast.success('Cập nhật họ tên thành công.');
  } catch (error: any) {
    nameError.value = error.response?.data?.message || 'Không thể cập nhật họ tên. Vui lòng thử lại.';
  } finally { savingName.value = false; }
}
async function savePassword() {
  if (savingPassword.value) return;
  passwordError.value = '';
  if (!currentPassword.value) passwordError.value = 'Vui lòng nhập mật khẩu hiện tại.';
  else if (newPassword.value.length < 8) passwordError.value = 'Mật khẩu mới phải có ít nhất 8 ký tự.';
  else if (newPassword.value !== confirmation.value) passwordError.value = 'Mật khẩu nhập lại không khớp.';
  else if (newPassword.value === currentPassword.value) passwordError.value = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (passwordError.value) return;
  savingPassword.value = true;
  try {
    await auth.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    confirmation.value = '';
    toast.success('Đổi mật khẩu thành công. Các thiết bị khác đã bị đăng xuất.');
  } catch (error: any) {
    passwordError.value = error.response?.data?.message || 'Không thể đổi mật khẩu. Vui lòng thử lại.';
  } finally { savingPassword.value = false; }
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
    <div>
      <h1 class="text-2xl sm:text-3xl font-extrabold text-foreground">Hồ sơ của tôi</h1>
      <p class="mt-2 text-sm text-muted-foreground">Quản lý thông tin cá nhân và mật khẩu tài khoản.</p>
    </div>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">Đang tải hồ sơ...</p>
    <div v-else-if="!auth.user" class="space-y-3">
      <p role="alert" class="text-sm text-danger">Không thể tải hồ sơ. Vui lòng thử lại.</p>
      <Button variant="outline" @click="loadProfile">Thử lại</Button>
    </div>
    <template v-else>
      <Card>
        <CardHeader><CardTitle as="h2">Thông tin tài khoản</CardTitle></CardHeader>
        <CardContent>
          <dl class="grid gap-5 sm:grid-cols-3">
            <div class="min-w-0"><dt class="text-muted-foreground">Email</dt><dd class="mt-1 break-words font-medium">{{ auth.user.email }}</dd></div>
            <div><dt class="text-muted-foreground">Vai trò</dt><dd class="mt-1 font-medium">{{ roleLabel }}</dd></div>
            <div><dt class="text-muted-foreground">Ngày tạo tài khoản</dt><dd class="mt-1 font-medium">{{ formatDateTime(auth.user.createdAt) }}</dd></div>
          </dl>
        </CardContent>
      </Card>
      <div class="grid gap-6 md:grid-cols-2 items-start">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Đổi họ tên</CardTitle>
            <CardDescription>Họ và tên có từ 2 đến 191 ký tự.</CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-4" novalidate @submit.prevent="saveName">
              <div class="space-y-2">
                <Label for="profile-name">Họ và tên</Label>
                <Input id="profile-name" v-model="fullName" type="text" autocomplete="name" required :disabled="savingName" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'name-error' : undefined" />
              </div>
              <p v-if="nameError" id="name-error" role="alert" class="text-sm text-danger">{{ nameError }}</p>
              <Button type="submit" :disabled="savingName || nameUnchanged" class="w-full sm:w-auto">{{ savingName ? 'Đang lưu...' : 'Lưu' }}</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Đổi mật khẩu</CardTitle>
            <CardDescription>Mật khẩu mới có ít nhất 8 ký tự và khác mật khẩu hiện tại.</CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-4" novalidate :aria-describedby="passwordError ? 'password-error' : undefined" @submit.prevent="savePassword">
              <fieldset :disabled="savingPassword" class="space-y-4">
                <legend class="sr-only">Thông tin đổi mật khẩu</legend>
                <div class="space-y-2">
                  <Label for="current-password">Mật khẩu hiện tại</Label>
                  <Input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required />
                </div>
                <div class="space-y-2">
                  <Label for="new-password">Mật khẩu mới</Label>
                  <Input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" minlength="8" required />
                </div>
                <div class="space-y-2">
                  <Label for="confirm-password">Nhập lại mật khẩu mới</Label>
                  <Input id="confirm-password" v-model="confirmation" type="password" autocomplete="new-password" minlength="8" required />
                </div>
                <Button type="submit" :disabled="savingPassword" class="w-full sm:w-auto">{{ savingPassword ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu' }}</Button>
              </fieldset>
              <p v-if="passwordError" id="password-error" role="alert" class="text-sm text-danger">{{ passwordError }}</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
