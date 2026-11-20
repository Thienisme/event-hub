import { test, expect } from '@playwright/test';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

const buyer = 'organizer2@eventhub.demo';

test('nhà tổ chức thêm nhân viên, nhân viên soát vé được ở trang Soát vé', async ({ page, request }) => {
  const organizerHeaders = authorization(await apiLogin(request, organizer));
  const me = await request.get(`${apiURL}/auth/me`, { headers: organizerHeaders });
  await expect(me).toBeOK();
  const { event, ticket } = await availableTicket(request, (await me.json()).user.id);
  const staffHeaders = authorization(await apiLogin(request, customer));
  const staffId = (await (await request.get(`${apiURL}/auth/me`, { headers: staffHeaders })).json()).user.id;
  // Dọn lượt chạy trước nếu bị dừng giữa chừng (404 = chưa là nhân viên).
  await request.delete(`${apiURL}/events/${event.id}/staff/${staffId}`, { headers: organizerHeaders });

  try {
    // Nhà tổ chức thêm nhân viên qua giao diện.
    await loginAs(page, request, organizer);
    await page.goto('/my-events');
    await page.getByRole('link', { name: `Nhân viên soát vé ${event.title}`, exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();
    await page.getByLabel('Email nhân viên', { exact: true }).fill(customer);
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    const list = page.getByRole('region', { name: 'Danh sách nhân viên' });
    await expect(list.getByText(customer, { exact: true })).toBeVisible();
    await expect(list.getByText(/Đã soát\s*0\s*vé/)).toBeVisible();

    // Một người khác mua vé để nhân viên soát.
    const buyerHeaders = authorization(await apiLogin(request, buyer));
    const created = await request.post(`${apiURL}/orders`, { headers: buyerHeaders, data: { ticketTypeId: ticket.id, quantity: 1 } });
    await expect(created).toBeOK();
    const { order } = await created.json();
    const confirmed = await request.post(`${apiURL}/orders/${order.id}/confirm`, { headers: buyerHeaders });
    await expect(confirmed).toBeOK();
    const qrCode: string = (await confirmed.json()).order.tickets[0].qrCode;

    // Nhân viên (tài khoản khách) thấy mục Soát vé trong menu và quét được vé.
    await loginAs(page, request, customer);
    await page.getByRole('button', { name: 'Mở menu tài khoản', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Soát vé', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sự kiện cần soát vé' })).toBeVisible();
    await page.getByRole('link', { name: `Soát vé ${event.title}`, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();
    await page.getByLabel('Nhập mã vé thủ công', { exact: true }).fill(qrCode);
    await page.getByRole('button', { name: 'Kiểm tra', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hợp lệ – mời vào', exact: true })).toBeVisible();

    // Nhân viên không vào được trang quản lý nhân viên (route chỉ cho nhà tổ chức).
    await page.goto(`/my-events/${event.id}/staff`);
    await expect(page).not.toHaveURL(/\/staff$/);
  } finally {
    await request.delete(`${apiURL}/events/${event.id}/staff/${staffId}`, { headers: organizerHeaders });
  }
});
