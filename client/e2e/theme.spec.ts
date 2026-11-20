import { test, expect } from '@playwright/test';

test('chọn chế độ màu Sáng / Tối / Theo hệ thống, nhớ lựa chọn sau khi tải lại', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  // Mặc định theo hệ thống: máy đang sáng nên không có class dark.
  await expect(html).not.toHaveClass(/\bdark\b/);

  const toggle = page.getByRole('button', { name: 'Chế độ màu', exact: true }).first();
  await toggle.click();
  await page.getByRole('menuitemradio', { name: 'Tối', exact: true }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Chế độ màu', exact: true }).first().click();
  await page.getByRole('menuitemradio', { name: 'Theo hệ thống', exact: true }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/\bdark\b/);
});
