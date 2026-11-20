import { test, expect } from '@playwright/test';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

const formatVnd = (value: number) => `${value.toLocaleString('vi-VN')} đ`;

test('bảng điều khiển: số liệu khớp API, lọc theo sự kiện và khoảng ngày', async ({ page, request }) => {
  const organizerHeaders = authorization(await apiLogin(request, organizer));
  const me = await request.get(`${apiURL}/auth/me`, { headers: organizerHeaders });
  await expect(me).toBeOK();
  const { event, ticket } = await availableTicket(request, (await me.json()).user.id);

  // Một đơn mới đã thanh toán để chắc chắn có doanh thu hôm nay.
  const headers = authorization(await apiLogin(request, customer));
  const created = await request.post(`${apiURL}/orders`, { headers, data: { ticketTypeId: ticket.id, quantity: 1 } });
  await expect(created).toBeOK();
  await expect(await request.post(`${apiURL}/orders/${(await created.json()).order.id}/confirm`, { headers })).toBeOK();

  const api = await request.get(`${apiURL}/organizer/dashboard`, { headers: organizerHeaders });
  await expect(api).toBeOK();
  const { summary } = (await api.json()).data;

  await loginAs(page, request, organizer);
  await page.goto('/my-events');
  await page.getByRole('link', { name: 'Bảng điều khiển', exact: true }).click();
  await expect(page).toHaveURL(/\/my-events\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bảng điều khiển bán vé' })).toBeVisible();

  const totals = page.getByRole('region', { name: 'Toàn thời gian' });
  // Số toàn thời gian nằm ở dòng chú thích của ô doanh thu và ô vé bán.
  await expect(totals).toContainText(`Toàn thời gian: ${formatVnd(summary.revenue)}`);
  await expect(totals).toContainText(`Đã bán ${summary.ticketsSold.toLocaleString('vi-VN')}/`);

  const daily = page.getByRole('region', { name: 'Doanh thu theo ngày' });
  await expect(daily.getByText(/^30 ngày gần nhất/)).toBeVisible();
  await page.getByRole('button', { name: '7 ngày', exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByRole('button', { name: '7 ngày', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(daily.getByText(/^7 ngày gần nhất/)).toBeVisible();

  // Bảng số liệu có đúng 7 dòng ngày.
  await daily.getByText('Xem dạng bảng', { exact: true }).click();
  await expect(daily.getByRole('table').getByRole('row')).toHaveCount(8);

  // Lọc một sự kiện: loại vé chỉ còn của sự kiện đó, URL giữ lựa chọn.
  await page.getByLabel('Sự kiện', { exact: true }).selectOption(event.id);
  await expect(page).toHaveURL(new RegExp(`eventId=${event.id}`));
  const types = page.getByRole('region', { name: 'Loại vé bán chạy' });
  await expect(types.getByText(ticket.name, { exact: true })).toBeVisible();
  const eventTypes = (await (await request.get(`${apiURL}/organizer/dashboard?eventId=${event.id}`, { headers: organizerHeaders })).json()).data.ticketTypes;
  await expect(types.getByRole('listitem')).toHaveCount(Math.min(10, eventTypes.length));
});

test('khách thường không vào được bảng điều khiển', async ({ page, request }) => {
  await loginAs(page, request, customer);
  await page.goto('/my-events/dashboard');
  await expect(page).not.toHaveURL(/dashboard/);
});
