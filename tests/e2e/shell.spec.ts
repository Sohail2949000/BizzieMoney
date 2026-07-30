import { expect, test } from '@playwright/test';

import { mockOwnerPreferences } from './preferences';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/bootstrap', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        authenticated: true,
        owner: {
          displayName: 'Jamie',
          email: 'jamie@example.com',
          id: '00000000-0000-4000-8000-000000000001',
        },
        sessionExpiresAt: '2026-08-03T08:00:00.000Z',
        setupRequired: false,
      },
    });
  });
  await mockOwnerPreferences(page);
});

test('application shell navigates and adapts to the selected theme', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your money, minus the noise.' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(
    page.getByRole('heading', { name: 'Expenses', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Use dark appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('button', { name: 'Use dark appearance' }),
  ).toHaveAttribute('aria-pressed', 'true');
});
