import { test, expect } from '@playwright/test';
import { listEvents } from './helpers';

test('lọc danh mục từ URL, đổi và xoá bộ lọc trên giao diện', async ({ page, request }) => {
  const music = await listEvents(request, 'category=MUSIC&status=upcoming');
  expect(music.length).toBeGreaterThan(0);
  expect(music.every(event => event.category === 'MUSIC')).toBeTruthy();
  await page.goto('/?category=MUSIC');
  const results = page.getByRole('region', { name: 'Danh sách sự kiện', exact: true });
  const categories = page.getByRole('group', { name: 'Danh mục sự kiện', exact: true });
  await expect(categories.getByRole('button', { name: /^Âm nhạc/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  await expect(results.getByRole('heading', { level: 3 })).toHaveText(music.map(event => event.title));
  for (const event of music) {
    const card = results.getByRole('link').filter({ has: page.getByRole('heading', { name: event.title, exact: true }) });
    await expect(card.getByText('Âm nhạc', { exact: true })).toBeVisible();
  }
  await categories.getByRole('button', { name: /^Thể thao/ }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('category') === 'SPORTS');
  await expect(categories.getByRole('button', { name: /^Thể thao/ })).toHaveAttribute('aria-pressed', 'true');
  // Danh mục có nút xoá riêng; nút trong bảng bộ lọc chỉ xoá ngày/giá/địa điểm.
  await page.getByRole('button', { name: 'Xoá bộ lọc Danh mục: Thể thao', exact: true }).click();
  await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click();
  await page.getByRole('button', { name: 'Dưới 200.000đ', exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('maxPrice') === '200000');
  await page.locator('[aria-label="Bộ lọc sự kiện"]').getByRole('button', { name: 'Xoá bộ lọc', exact: true }).click();
  // Xoá bộ lọc chỉ cần bỏ hết tham số lọc; `page` có thể còn lại.
  const filterKeys = ['category', 'location', 'from', 'to', 'minPrice', 'maxPrice', 'search'];
  await expect(page).toHaveURL(url => filterKeys.every(key => !url.searchParams.has(key)));
});
