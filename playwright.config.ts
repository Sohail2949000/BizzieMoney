import { defineConfig, devices } from '@playwright/test';

const includeFirefox =
  process.platform !== 'win32' || process.env.PLAYWRIGHT_FIREFOX === 'true';
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          'node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1',
        port: 4173,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
    ...(includeFirefox
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
        ]
      : []),
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
