import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
// Client dev ở 5173 + server ở 5000: đặt E2E_API_URL=http://localhost:5000/api.
// Helper dùng E2E_API_URL, mặc định `${baseURL}/api`, cho fixture request.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
