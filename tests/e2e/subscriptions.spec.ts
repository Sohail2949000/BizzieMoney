import { expect, test } from '@playwright/test';

import { mockOwnerPreferences } from './preferences';

const category = {
  archived: false,
  color: '#D97706',
  icon: 'receipt',
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Bills & Utilities',
};
const paymentMethod = {
  archived: false,
  icon: 'credit-card',
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Bank card',
};

test.beforeEach(async ({ page }) => {
  let subscription: Record<string, unknown> | null = null;
  let payment: Record<string, unknown> | null = null;

  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({
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
    }),
  );
  await mockOwnerPreferences(page);
  await page.route('**/api/expense-options**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { categories: [category], paymentMethods: [paymentMethod] },
    }),
  );
  await page.route('**/api/attachment-storage', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        allowedMimeTypes: ['text/plain'],
        availableProviders: ['local'],
        fileCount: 0,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20 * 1_048_576,
        provider: 'local',
        providerLabel: 'Local host folder',
        totalSizeBytes: 0,
      },
    }),
  );
  await page.route('**/api/subscription-reminders', (route) =>
    route.fulfill({ contentType: 'application/json', json: [] }),
  );
  await page.route('**/api/subscriptions/upcoming**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        dueSoonCount: subscription ? 1 : 0,
        items: subscription ? [subscription] : [],
        overdueCount: 0,
      },
    }),
  );
  await page.route(/\/api\/subscriptions(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      subscription = {
        ...(request.postDataJSON() as Record<string, unknown>),
        attachmentCount: 0,
        category,
        createdAt: '2026-07-27T08:00:00.000Z',
        currencyCode: 'USD',
        id: '00000000-0000-4000-8000-000000000010',
        status: 'active',
        updatedAt: '2026-07-27T08:00:00.000Z',
      };
      await route.fulfill({
        contentType: 'application/json',
        json: subscription,
        status: 201,
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: { items: subscription ? [subscription] : [], nextCursor: null },
    });
  });
  await page.route(/\/api\/subscriptions\/[^/?]+\/attachments$/, (route) =>
    route.fulfill({ contentType: 'application/json', json: [] }),
  );
  await page.route(
    /\/api\/subscriptions\/[^/?]+\/(pause|resume|cancel)$/,
    async (route) => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1);
      subscription = {
        ...subscription,
        status:
          action === 'pause'
            ? 'paused'
            : action === 'resume'
              ? 'active'
              : 'cancelled',
      };
      await route.fulfill({
        contentType: 'application/json',
        json: subscription,
      });
    },
  );
  await page.route(
    /\/api\/subscriptions\/[^/?]+\/payments(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === 'POST') {
        payment = {
          amount: '29.9900',
          convertedExpenseId: null,
          createdAt: '2026-07-27T08:00:00.000Z',
          currencyCode: 'USD',
          id: '00000000-0000-4000-8000-000000000011',
          paidDate: '2026-07-27',
          scheduledDate: '2026-08-01',
          subscriptionId: subscription?.id,
          subscriptionName: subscription?.name,
        };
        await route.fulfill({
          contentType: 'application/json',
          json: payment,
          status: 201,
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        json: { items: payment ? [payment] : [], nextCursor: null },
      });
    },
  );
  await page.route(
    /\/api\/subscription-payments\/[^/?]+\/convert$/,
    async (route) => {
      payment = {
        ...payment,
        convertedExpenseId: '00000000-0000-4000-8000-000000000012',
      };
      await route.fulfill({
        contentType: 'application/json',
        json: { expenseId: payment.convertedExpenseId },
        status: 201,
      });
    },
  );
});

test('subscription creation, status, payment, and conversion stay explicit', async ({
  page,
}) => {
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: 'Add subscription' }).first().click();
  await page.getByLabel('Name').fill('Home internet');
  await page.getByLabel('Amount').fill('29.99');
  await page.getByLabel('Next payment', { exact: true }).fill('2026-08-01');
  await page.getByRole('button', { name: 'Save subscription' }).click();

  await expect(
    page.getByRole('button', { name: 'Pause Home internet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause Home internet' }).click();
  await expect(
    page.getByRole('button', { name: 'Resume Home internet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume Home internet' }).click();
  await expect(
    page.getByRole('button', { name: 'Pause Home internet' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Payment history for Home internet' })
    .click();
  const paymentDialog = page.getByRole('dialog', { name: 'Home internet' });
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    const paidDateBox = await paymentDialog
      .getByLabel('Paid date')
      .boundingBox();
    const amountBox = await paymentDialog.getByLabel('Amount').boundingBox();
    expect(paidDateBox).not.toBeNull();
    expect(amountBox).not.toBeNull();
    if (!paidDateBox || !amountBox) {
      throw new Error('Payment fields did not render.');
    }
    expect(Math.abs(paidDateBox.y - amountBox.y)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Record payment' }).click();
  const convertPaymentButton = page.getByRole('button', {
    name: 'Convert to expense',
  });
  await expect(convertPaymentButton).toBeVisible();
  await convertPaymentButton.click();
  await expect(page.getByText('Expense created')).toBeVisible();
});
