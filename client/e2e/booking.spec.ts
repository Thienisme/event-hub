import { test, expect } from '@playwright/test';
import { availableTicket, customer, loginAs } from './helpers';

test('đặt một vé, thanh toán MOCK và xem mã QR', async ({ page, request }) => {
  const { event, ticket } = await availableTicket(request);
  await loginAs(page, request, customer);
  await page.goto(`/events/${event.slug ?? event.id}`);
  const quantity = page.getByRole('spinbutton', { name: `Số lượng vé ${ticket.name}`, exact: true });
  await quantity.fill('1');
  // Khoanh vùng bằng tên loại vé, không dựa vào class trình bày.
  const ticketCard = page.locator('div').filter({ has: page.getByRole('heading', { name: ticket.name, exact: true }) })
    .filter({ has: quantity }).filter({ has: page.getByRole('button', { name: 'Đặt vé', exact: true }) }).last();
  await ticketCard.getByRole('button', { name: 'Đặt vé', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/[^/?]+$/);
  const orderId = new URL(page.url()).pathname.split('/').pop()!;
  await page.getByRole('radio', { name: /Thanh toán thử/ }).check();
  await page.getByRole('button', { name: /^Thanh toán / }).click();
  await expect(page.getByText('Thanh toán thành công', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/my-orders$/);
  await page.getByRole('link', { name: 'Vé của tôi', exact: true }).filter({ visible: true }).click();
  const order = page.locator(`article[id="order-${orderId}"]`);
  await expect(order.getByText('Đã xác nhận', { exact: true })).toBeVisible();
  const toggle = order.getByRole('button', { name: 'Xem 1 vé', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(order.getByRole('img', { name: 'Mã QR của vé', exact: true })).toBeVisible();
});
