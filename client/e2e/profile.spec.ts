import { test, expect } from '@playwright/test';
import { apiURL, authorization, customer, loginAs } from './helpers';

test('đổi họ tên, cập nhật header và khôi phục tên cũ', async ({ page, request }) => {
  const token = await loginAs(page, request, customer);
  const headers = authorization(token);
  const me = await request.get(`${apiURL}/auth/me`, { headers });
  await expect(me).toBeOK();
  const original = (await me.json()).user.fullName;
  const updated = `Khách E2E ${Date.now()}`;
  const menu = page.getByRole('button', { name: 'Mở menu tài khoản', exact: true });
  try {
    await page.goto('/profile');
    await page.getByLabel('Họ và tên', { exact: true }).fill(updated);
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(menu).toContainText(updated);
    await page.getByLabel('Họ và tên', { exact: true }).fill(original);
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(menu).toContainText(original);
  } finally {
    // Vẫn trả lại dữ liệu dùng chung nếu assertion hoặc giao diện lỗi giữa chừng.
    const restored = await request.patch(`${apiURL}/auth/me`, { headers, data: { fullName: original } });
    await expect(restored).toBeOK();
  }
});
