import { test, expect } from '@playwright/test';
import { customer, password } from './helpers';

test('chuyển về trang trước sau đăng nhập bằng form và đăng xuất', async ({ page }) => {
  await page.goto('/my-orders');
  await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === '/my-orders');
  await page.getByLabel('Email', { exact: true }).fill(customer);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  const response = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const login = await response;
  expect(login.ok()).toBeTruthy();
  const { user } = await login.json();
  await expect(page).toHaveURL(/\/my-orders$/);
  const menu = page.getByRole('button', { name: 'Mở menu tài khoản', exact: true });
  await expect(menu).toContainText(user.fullName);
  await menu.click();
  await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
  // Đăng xuất khi đang ở trang cần đăng nhập thì router đưa về trang đăng nhập.
  await expect(page).toHaveURL(url => url.pathname === '/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});
