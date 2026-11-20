import { test, expect } from '@playwright/test';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

test('chuyển vé cho tài khoản khác, người nhận thấy vé và mã QR', async ({ page, request }) => {
  const organizerToken = await apiLogin(request, organizer);
  const me = await request.get(`${apiURL}/auth/me`, { headers: authorization(organizerToken) });
  await expect(me).toBeOK();
  const { event, ticket } = await availableTicket(request, (await me.json()).user.id);
  const headers = authorization(await apiLogin(request, customer));
  const created = await request.post(`${apiURL}/orders`, { headers, data: { ticketTypeId: ticket.id, quantity: 1 } });
  await expect(created).toBeOK();
  const { order } = await created.json();
  await expect(await request.post(`${apiURL}/orders/${order.id}/confirm`, { headers })).toBeOK();

  // Khách mở đúng đơn vừa mua, bung danh sách vé nếu đang thu gọn rồi chuyển vé.
  await loginAs(page, request, customer);
  await page.goto('/my-orders');
  const card = page.locator(`#order-${order.id}`);
  const transferButton = card.getByRole('button', { name: 'Chuyển vé 1', exact: true });
  if (!(await transferButton.isVisible())) await card.getByRole('button', { name: /Xem 1 vé/ }).click();
  await transferButton.click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email người nhận', { exact: true }).fill(organizer);
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.getByText(`Chuyển vé cho ${organizer}?`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Xác nhận chuyển', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText(/Đã chuyển cho/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Xem lớn mã QR vé 1', exact: true })).toHaveCount(0);

  // Người nhận thấy vé ở mục riêng, kèm mã QR động.
  await loginAs(page, request, organizer);
  await page.goto('/my-orders');
  const received = page.getByRole('region', { name: 'Vé được chuyển cho bạn' });
  await expect(received).toBeVisible();
  await expect(received.getByText(event.title).first()).toBeVisible();
  await expect(received.getByText(/Mã đổi sau \d+s/).first()).toBeVisible();
});
