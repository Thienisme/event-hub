// Đặt chế độ sáng/tối TRƯỚC khi trang vẽ để không bị nháy màu.
// File riêng (không viết inline trong index.html) vì CSP chỉ cho script-src 'self'.
// Lựa chọn lưu ở localStorage 'theme': 'light' | 'dark' | 'system' (mặc định 'system').
// Logic đổi chế độ khi người dùng chọn nằm ở src/utils/theme.ts; hai nơi phải khớp nhau.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('theme') || 'system'; } catch (e) { /* chế độ riêng tư */ }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#23252C' : '#EEF0F3');
})();
