import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

/**
 * Tính chuỗi mã QR động y theo hợp đồng với server:
 * `EH1.<ticketId>.<step>.<sig>`, sig = 16 byte đầu HMAC-SHA256(key = qrCode,
 * message = `EH1.<ticketId>.<step>`), base64url không padding.
 */
function buildDynamicQr(qrCode: string, ticketId: string, nowMs = Date.now()): string {
  const step = Math.floor(nowMs / 1000 / 30);
  const sig = createHmac('sha256', qrCode).update(`EH1.${ticketId}.${step}`).digest().subarray(0, 16).toString('base64url');
  return `EH1.${ticketId}.${step}.${sig}`;
}

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

test('khách thấy mã QR động ở Vé của tôi và mã động soát được', async ({ page, request }) => {
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
  const orderData = (await confirmed.json()).order;
  const qrCode = orderData.tickets[0].qrCode as string;
  const ticketId = orderData.tickets[0].id as string;
  expect(qrCode).toEqual(expect.any(String));

  // Khách mở "Vé của tôi": vé sắp tới mở sẵn mã QR, phải thấy nhãn mã động.
  await loginAs(page, request, customer);
  await page.goto('/my-orders');
  // Mục QR của các đơn thu gọn vẫn nằm trong DOM (v-show), chỉ lấy cái đang hiện.
  await expect(page.getByText(/Mã đổi sau \d+s/).filter({ visible: true }).first()).toBeVisible();

  // Nhân viên nhập mã động (client tự tính) ở trang soát vé -> hợp lệ.
  // Tránh bước ranh giới 30 giây: đồng hồ máy test có thể lệch nhẹ với server.
  const secondsIntoStep = Math.floor(Date.now() / 1000) % 30;
  if (secondsIntoStep > 27) await page.waitForTimeout((30 - secondsIntoStep + 1) * 1000);
  await loginAs(page, request, organizer);
  await page.goto(`/my-events/${event.id}/check-in`);
  await page.getByLabel('Nhập mã vé thủ công', { exact: true }).fill(buildDynamicQr(qrCode, ticketId));
  await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hợp lệ – mời vào', exact: true })).toBeVisible();
});
