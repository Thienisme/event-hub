import { test, expect } from '@playwright/test';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

test('soát vé nhập tay hợp lệ rồi báo vé đã dùng', async ({ page, request }) => {
  const organizerToken = await apiLogin(request, organizer);
  const me = await request.get(`${apiURL}/auth/me`, { headers: authorization(organizerToken) });
  await expect(me).toBeOK();
  const { event, ticket } = await availableTicket(request, (await me.json()).user.id);
  const headers = authorization(await apiLogin(request, customer));
  const created = await request.post(`${apiURL}/orders`, { headers, data: { ticketTypeId: ticket.id, quantity: 1 } });
  await expect(created).toBeOK();
  const { order } = await created.json();
  const confirmed = await request.post(`${apiURL}/orders/${order.id}/confirm`, { headers });
  await expect(confirmed).toBeOK();
  const qrCode = (await confirmed.json()).order.tickets[0].qrCode;
  expect(qrCode).toEqual(expect.any(String));
  await loginAs(page, request, organizer);
  await page.goto(`/my-events/${event.id}/check-in`);
  await expect(page.getByRole('button', { name: 'Bật camera', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Nhập mã vé thủ công', { exact: true }).fill(qrCode);
  await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hợp lệ – mời vào', exact: true })).toBeVisible();
  // Trang bỏ qua cùng mã trong 3 giây; chờ qua cửa sổ chống quét lặp.
  await page.waitForTimeout(3100);
  await page.getByLabel('Nhập mã vé thủ công', { exact: true }).fill(qrCode);
  await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Vé đã dùng lúc/ })).toBeVisible();
});
