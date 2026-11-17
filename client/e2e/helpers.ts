import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const customer = 'khach@eventhub.demo';
export const organizer = 'organizer@eventhub.demo';
export const password = process.env.E2E_PASSWORD ?? 'demo12345';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
export const apiURL = process.env.E2E_API_URL ?? `${baseURL}/api`;
export const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function apiLogin(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  await expect(response).toBeOK();
  const { token } = await response.json();
  expect(token).toEqual(expect.any(String));
  return token;
}

export async function loginAs(page: Page, request: APIRequestContext, email: string) {
  const token = await apiLogin(request, email);
  await page.addInitScript(token => localStorage.setItem('token', token), token);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mở menu tài khoản', exact: true })).toBeVisible();
  return token;
}

export interface DemoEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  organizerId: string;
  startTime: string;
  ticketTypes: Array<{
    id: string; name: string; price: string | number; availableQuantity: number;
    saleStart?: string | null; saleEnd?: string | null;
  }>;
}

export async function listEvents(request: APIRequestContext, query = ''): Promise<DemoEvent[]> {
  const events: DemoEvent[] = [];
  for (let page = 1; ; page++) {
    const response = await request.get(`${apiURL}/events?limit=100&page=${page}&${query}`);
    await expect(response).toBeOK();
    const body = await response.json();
    events.push(...body.data);
    if (page >= body.pagination.totalPages) return events;
  }
}

export async function availableTicket(request: APIRequestContext, organizerId?: string) {
  const now = Date.now();
  for (const event of await listEvents(request)) {
    if (Date.parse(event.startTime) <= now || (organizerId && event.organizerId !== organizerId)) continue;
    const ticket = event.ticketTypes.find(ticket =>
      Number(ticket.price) > 0 && ticket.availableQuantity > 0 &&
      (!ticket.saleStart || Date.parse(ticket.saleStart) <= now) &&
      (!ticket.saleEnd || Date.parse(ticket.saleEnd) > now));
    if (ticket) return { event, ticket };
  }
  throw new Error('Dữ liệu demo không còn sự kiện sắp diễn ra có vé trả phí đang mở bán.');
}
