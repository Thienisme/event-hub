<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/format';
import UserAvatar from '@/components/UserAvatar.vue';
import { Camera, Trash2 } from '@lucide/vue';
import { MAX_BANNER_BYTES, ALLOWED_BANNER_TYPES } from '@/utils/media';
import { Input } from '@/components/ui/input';
import PasswordInput from '@/components/PasswordInput.vue';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const auth = useAuthStore();
const toast = useToastStore();
const loading = ref(true);
const fullName = ref('');
const savingName = ref(false);
const nameError = ref('');
const avatarInput = ref<HTMLInputElement | null>(null);
const savingAvatar = ref(false);
const avatarError = ref('');
async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || savingAvatar.value) return;
  avatarError.value = '';
  if (!ALLOWED_BANNER_TYPES.includes(file.type)) {
    avatarError.value = 'Vui lòng chọn ảnh JPG, PNG hoặc WEBP.';
    return;
  }
  if (file.size > MAX_BANNER_BYTES) {
    avatarError.value = 'Ảnh không được vượt quá 5MB.';
    return;
  }
  savingAvatar.value = true;
  try {
    await auth.updateAvatar(file);
    toast.success('Đã cập nhật ảnh đại diện.');
  } catch (error: any) {
    avatarError.value = error.response?.data?.message || 'Không thể tải ảnh. Vui lòng thử lại.';
  } finally { savingAvatar.value = false; }
}
async function removeAvatar() {
  if (savingAvatar.value) return;
  avatarError.value = '';
  savingAvatar.value = true;
  try {
    await auth.removeAvatar();
    toast.success('Đã xoá ảnh đại diện.');
  } catch (error: any) {
    avatarError.value = error.response?.data?.message || 'Không thể xoá ảnh. Vui lòng thử lại.';
  } finally { savingAvatar.value = false; }
}
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
  <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
    <div>
      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">Hồ sơ của tôi</h1>
      <p class="mt-2 text-sm text-muted-foreground">Cập nhật diện mạo, thông tin cá nhân và bảo mật tài khoản.</p>
    </div>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">Đang tải hồ sơ...</p>
    <div v-else-if="!auth.user" class="space-y-3">
      <p role="alert" class="text-sm text-danger">Không thể tải hồ sơ. Vui lòng thử lại.</p>
      <Button variant="outline" @click="loadProfile">Thử lại</Button>
    </div>
    <template v-else>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Thông tin cá nhân</CardTitle>
          <CardDescription>Ảnh và họ tên giúp bạn dễ được nhận diện trên EventHub.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-center" :aria-busy="savingAvatar">
            <UserAvatar :name="auth.user.fullName" :url="auth.user.avatarUrl" class="size-20 text-2xl" />
            <div class="min-w-0 space-y-3">
              <div>
                <p class="font-semibold">Ảnh đại diện</p>
                <p id="avatar-hint" class="mt-1 text-sm text-muted-foreground">JPG, PNG hoặc WEBP, tối đa 5MB. Nên dùng ảnh vuông.</p>
              </div>
              <input ref="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-label="Chọn ảnh đại diện" aria-describedby="avatar-hint" :disabled="savingAvatar" @change="uploadAvatar" />
              <div class="flex flex-wrap gap-2">
                <Button type="button" variant="outline" :disabled="savingAvatar" @click="avatarInput?.click()"><Camera class="size-4" aria-hidden="true" />{{ savingAvatar ? 'Đang cập nhật...' : 'Đổi ảnh' }}</Button>
                <Button v-if="auth.user.avatarUrl" type="button" variant="ghost" :disabled="savingAvatar" @click="removeAvatar"><Trash2 class="size-4" aria-hidden="true" />Xoá ảnh</Button>
              </div>
              <p v-if="avatarError" role="alert" class="text-sm text-danger">{{ avatarError }}</p>
              <p v-if="savingAvatar" role="status" class="text-sm text-muted-foreground">Đang cập nhật ảnh đại diện...</p>
            </div>
          </div>
          <form class="space-y-4 border-b border-border py-6" novalidate @submit.prevent="saveName">
            <div class="space-y-2">
              <Label for="profile-name">Họ và tên</Label>
              <Input id="profile-name" v-model="fullName" type="text" autocomplete="name" maxlength="191" required :disabled="savingName" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'name-error' : 'name-hint'" />
              <p id="name-hint" class="text-xs text-muted-foreground">Tên hiển thị trên hồ sơ và vé của bạn, từ 2 đến 191 ký tự.</p>
            </div>
            <p v-if="nameError" id="name-error" role="alert" class="text-sm text-danger">{{ nameError }}</p>
            <Button type="submit" :disabled="savingName || nameUnchanged" class="w-full sm:w-auto">{{ savingName ? 'Đang lưu...' : 'Lưu thay đổi' }}</Button>
          </form>
          <dl class="grid gap-5 pt-6 text-sm sm:grid-cols-3">
            <div class="min-w-0"><dt class="text-muted-foreground">Email</dt><dd class="mt-1 break-words font-medium">{{ auth.user.email }}</dd></div>
            <div><dt class="text-muted-foreground">Vai trò</dt><dd class="mt-1 font-medium">{{ roleLabel }}</dd></div>
            <div><dt class="text-muted-foreground">Ngày tạo tài khoản</dt><dd class="mt-1 font-medium">{{ formatDateTime(auth.user.createdAt) }}</dd></div>
          </dl>
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
                  <PasswordInput id="current-password" v-model="currentPassword" autocomplete="current-password" required />
                </div>
                <div class="space-y-2">
                  <Label for="new-password">Mật khẩu mới</Label>
                  <PasswordInput id="new-password" v-model="newPassword" autocomplete="new-password" minlength="8" required />
                </div>
                <div class="space-y-2">
                  <Label for="confirm-password">Nhập lại mật khẩu mới</Label>
                  <PasswordInput id="confirm-password" v-model="confirmation" autocomplete="new-password" minlength="8" required />
                </div>
                <Button type="submit" :disabled="savingPassword" class="w-full sm:w-auto">{{ savingPassword ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu' }}</Button>
              </fieldset>
              <p v-if="passwordError" id="password-error" role="alert" class="text-sm text-danger">{{ passwordError }}</p>
            </form>
          </CardContent>
        </Card>
    </template>
  </div>
</template>
