import { readonly, ref } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';
// Phải khớp với client/public/theme-init.js và biến --surface trong client/src/style.css.
const THEME_COLOR_DARK = '#23252C';
const THEME_COLOR_LIGHT = '#EEF0F3';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function prefersSystemDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function resolveDark(pref: ThemePreference): boolean {
  return pref === 'dark' || (pref === 'system' && prefersSystemDark());
}

/** Đọc lựa chọn chế độ màu đã lưu; giá trị lạ hoặc lỗi truy cập trả về 'system'. */
export function getThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(saved)) return saved;
  } catch {
    // Chế độ riêng tư hoặc môi trường chặn localStorage.
  }
  return 'system';
}

// Trạng thái dùng chung giữa mọi component gọi useTheme().
const preference = ref<ThemePreference>(getThemePreference());
const darkState = ref<boolean>(resolveDark(preference.value));
const isDark = readonly(darkState);
let systemListenerAttached = false;

/** Áp dụng class `dark` lên <html> và cập nhật meta theme-color khớp với theme-init.js. */
export function applyTheme(pref: ThemePreference): void {
  const dark = resolveDark(pref);
  darkState.value = dark;
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
}

function ensureSystemListener(): void {
  if (systemListenerAttached) return;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  media.addEventListener('change', () => {
    // Giữ một listener duy nhất; khi người dùng chọn cố định 'light'/'dark' thì bỏ qua.
    if (preference.value === 'system') {
      applyTheme('system');
    }
  });
  systemListenerAttached = true;
}

/** Lưu lựa chọn chế độ màu vào localStorage và áp dụng ngay lên trang. */
export function setThemePreference(pref: ThemePreference): void {
  preference.value = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Không ghi được localStorage vẫn áp dụng cho phiên hiện tại.
  }
  applyTheme(pref);
  if (pref === 'system') {
    ensureSystemListener();
  }
}

if (preference.value === 'system') {
  ensureSystemListener();
}

export function useTheme() {
  if (preference.value === 'system') {
    ensureSystemListener();
  }
  return {
    preference,
    isDark,
    setPreference: setThemePreference,
  };
}
