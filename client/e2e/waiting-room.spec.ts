import { test, expect } from '@playwright/test';
import { apiLogin, apiURL, authorization, availableTicket, customer, loginAs, organizer } from './helpers';

test('vào phòng chờ, nhận lượt mua và đặt một vé tới trang thanh toán', async ({ page, request }) => {
  const token = await apiLogin(request, organizer);
  const headers = authorization(token);
  const profile = await request.get(`${apiURL}/auth/me`, { headers });
  await expect(profile).toBeOK();
  const profileBody = await profile.json();
  const organizerId = (profileBody.user ?? profileBody.data ?? profileBody).id;
  expect(organizerId).toEqual(expect.any(String));
  const { event, ticket } = await availableTicket(request, organizerId);
  const detail = await request.get(`${apiURL}/events/${event.id}`);
  await expect(detail).toBeOK();
  const { data } = await detail.json();
  const payload = {
    title: data.title,
    description: data.description || null,
    location: data.location,
    category: data.category || 'OTHER',
    bannerUrl: data.bannerUrl || null,
    startTime: data.startTime,
    endTime: data.endTime,
    queueActiveLimit: 100,
    ticketTypes: data.ticketTypes.map((t: { id: string; name: string; price: string | number; totalQuantity: number; saleStart?: string | null; saleEnd?: string | null }) => ({
      id: t.id, name: t.name, price: Number(t.price), totalQuantity: t.totalQuantity,
      saleStart: t.saleStart || null, saleEnd: t.saleEnd || null,
    })),
  };
  let orderId: string | undefined;
  let customerToken: string | undefined;
  try {
    const enabled = await request.put(`${apiURL}/events/${event.id}`, { headers, data: { ...payload, queueEnabled: true } });
    await expect(enabled).toBeOK();
    customerToken = await loginAs(page, request, customer);
    await page.goto(`/events/${event.slug ?? event.id}`);
    await page.getByRole('button', { name: 'Vào phòng chờ', exact: true }).click();
    await expect(page).toHaveURL(/\/events\/[^/?]+\?queuePass=1$/);
    await expect(page.getByRole('status').filter({ hasText: 'Đến lượt bạn!' })).toBeVisible();
    const quantity = page.getByRole('spinbutton', { name: `Số lượng vé ${ticket.name}`, exact: true });
    await quantity.fill('1');
    const ticketCard = page.locator('div').filter({ has: page.getByRole('heading', { name: ticket.name, exact: true }) })
      .filter({ has: quantity }).filter({ has: page.getByRole('button', { name: 'Đặt vé', exact: true }) }).last();
    await ticketCard.getByRole('button', { name: 'Đặt vé', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/[^/?]+$/);
    orderId = new URL(page.url()).pathname.split('/').pop();
  } finally {
    try {
      if (customerToken && orderId) {
        const cancelled = await request.post(`${apiURL}/orders/${orderId}/cancel`, { headers: authorization(customerToken) });
        await expect(cancelled).toBeOK();
      }
    } finally {
      const disabled = await request.put(`${apiURL}/events/${event.id}`, { headers, data: { ...payload, queueEnabled: false } });
      await expect(disabled).toBeOK();
    }
  }
});
