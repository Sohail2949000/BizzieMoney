import { expect, test } from '@playwright/test';

import { mockOwnerPreferences } from './preferences';

test('first-time owner setup opens the authenticated application', async ({
  page,
}) => {
  let setupComplete = false;
  await page.route('**/api/auth/bootstrap', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: setupComplete
        ? {
            authenticated: true,
            owner: {
              displayName: 'Jamie',
              email: 'jamie@example.com',
              id: '00000000-0000-4000-8000-000000000001',
            },
            sessionExpiresAt: '2026-08-03T08:00:00.000Z',
            setupRequired: false,
          }
        : {
            authenticated: false,
            owner: null,
            sessionExpiresAt: null,
            setupRequired: true,
          },
    });
  });
  await page.route('**/api/auth/setup', async (route) => {
    setupComplete = true;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        owner: {
          displayName: 'Jamie',
          email: 'jamie@example.com',
          id: '00000000-0000-4000-8000-000000000001',
        },
        sessionExpiresAt: '2026-08-03T08:00:00.000Z',
      },
      status: 201,
    });
  });
  await mockOwnerPreferences(page);

  await page.goto('/');
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByLabel('Email').fill('jamie@example.com');
  await page.locator('#setup-password').fill('a-long-owner-password');
  await page.locator('#setup-confirm-password').fill('a-long-owner-password');
  await page.getByRole('button', { name: 'Create owner account' }).click();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(
    page.getByText('Welcome, Jamie.', { exact: false }),
  ).toBeVisible();
});

test('an existing owner can sign in without a public registration path', async ({
  page,
}) => {
  let authenticated = false;
  await page.route('**/api/auth/bootstrap', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: authenticated
        ? {
            authenticated: true,
            owner: {
              displayName: 'Jamie',
              email: 'jamie@example.com',
              id: '00000000-0000-4000-8000-000000000001',
            },
            sessionExpiresAt: '2026-08-03T08:00:00.000Z',
            setupRequired: false,
          }
        : {
            authenticated: false,
            owner: null,
            sessionExpiresAt: null,
            setupRequired: false,
          },
    });
  });
  await page.route('**/api/auth/login', async (route) => {
    authenticated = true;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        owner: {
          displayName: 'Jamie',
          email: 'jamie@example.com',
          id: '00000000-0000-4000-8000-000000000001',
        },
        sessionExpiresAt: '2026-08-03T08:00:00.000Z',
      },
    });
  });
  await mockOwnerPreferences(page);

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your money is ready when you are.' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill('jamie@example.com');
  await page.getByLabel('Password').fill('a-long-owner-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Expenses' })).toBeVisible();
});
