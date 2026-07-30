import { expect, test } from '@playwright/test';

import { defaultOwnerPreferences, mockOwnerPreferences } from './preferences';

const owner = {
  displayName: 'Jamie',
  email: 'jamie@example.com',
  id: '00000000-0000-4000-8000-000000000001',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        authenticated: true,
        owner,
        sessionExpiresAt: '2026-08-03T08:00:00.000Z',
        setupRequired: false,
      },
    }),
  );
  await mockOwnerPreferences(page);
  await page.route('**/api/auth/sessions', (route) =>
    route.fulfill({ contentType: 'application/json', json: { sessions: [] } }),
  );
  await page.route('**/api/expense-options**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        categories: [
          {
            archived: false,
            color: '#16A36A',
            icon: 'utensils',
            id: '00000000-0000-4000-8000-000000000003',
            name: 'Food & Dining',
          },
        ],
        paymentMethods: [
          {
            archived: false,
            icon: 'circle-ellipsis',
            id: '00000000-0000-4000-8000-000000000004',
            name: 'Other',
          },
        ],
      },
    }),
  );
  await page.route('**/api/attachment-storage', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        allowedMimeTypes: ['application/pdf', 'image/jpeg'],
        availableProviders: ['local'],
        configuration: {
          provider: 'local',
          s3: null,
          source: 'environment',
          updatedAt: null,
        },
        fileCount: 4,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20_971_520,
        provider: 'local',
        providerLabel: 'Local host folder',
        totalSizeBytes: 13_316_915,
      },
    }),
  );
  await page.route('**/api/backups/config', (route) =>
    route.fulfill({ contentType: 'application/json', json: { config: null } }),
  );
  await page.route('**/api/backups/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        activeJob: null,
        config: null,
        configured: false,
        lastSuccessfulBackup: null,
        worker: { lastSeenAt: null, status: 'unknown' },
      },
    }),
  );
  await page.route('**/api/backups/history', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { artifacts: [], jobs: [] },
    }),
  );
});

test('settings disclosures start collapsed and owner details can be updated', async ({
  page,
}) => {
  let submittedProfile: Record<string, string> | undefined;
  await page.route('**/api/auth/profile', async (route) => {
    submittedProfile = route.request().postDataJSON() as Record<string, string>;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        message: 'Account details updated.',
        owner: {
          ...owner,
          displayName: 'Jamie Doe',
          email: 'jamie.doe@example.com',
        },
      },
    });
  });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  for (const id of [
    'owner-account',
    'regional-preferences',
    'appearance',
    'categories',
    'payment-methods',
    'file-storage',
    'backups',
    'data-management',
    'change-password',
    'active-sessions',
  ]) {
    await expect(page.locator(`details#${id}`)).not.toHaveAttribute('open', '');
  }

  const categories = page.locator('details#categories');
  await categories.locator('summary').click();
  await expect(categories).toHaveAttribute('open', '');
  await expect(
    categories.locator('input[aria-label="Food & Dining name"]'),
  ).toHaveValue('Food & Dining');
  await categories.locator('summary').click();
  await expect(categories).not.toHaveAttribute('open', '');

  const ownerAccount = page.locator('details#owner-account');
  await ownerAccount.locator('summary').click();
  await expect(ownerAccount).toHaveAttribute('open', '');
  await ownerAccount.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#owner-display-name').fill('Jamie Doe');
  await page.locator('#owner-email').fill('jamie.doe@example.com');
  await page.locator('#owner-current-password').fill('current-owner-password');
  await page.getByRole('button', { name: 'Save details' }).click();

  await expect(page.getByText('Account details updated.')).toBeVisible();
  await expect(
    ownerAccount.getByRole('button', { name: 'Edit' }),
  ).toBeVisible();
  await expect(
    ownerAccount.getByText('Jamie Doe', { exact: true }),
  ).toBeVisible();
  expect(submittedProfile).toEqual({
    currentPassword: 'current-owner-password',
    displayName: 'Jamie Doe',
    email: 'jamie.doe@example.com',
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test('an in-use category is reassigned before permanent deletion', async ({
  page,
}) => {
  const food = {
    archived: false,
    color: '#16A36A',
    icon: 'utensils',
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Food & Dining',
  };
  const other = {
    archived: false,
    color: '#71717A',
    icon: 'circle-ellipsis',
    id: '00000000-0000-4000-8000-000000000009',
    name: 'Other',
  };
  let categories = [food, other];
  let submitted: { replacementCategoryId: string } | undefined;
  await page.unroute('**/api/expense-options**');
  await page.route('**/api/expense-options**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        categories,
        paymentMethods: [
          {
            archived: false,
            icon: 'circle-ellipsis',
            id: '00000000-0000-4000-8000-000000000004',
            name: 'Other',
          },
        ],
      },
    }),
  );
  await page.route('**/api/expense-categories/**', async (route) => {
    if (route.request().url().endsWith('/deletion-preview')) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          category: food,
          expenseCount: 2,
          replacements: [other],
          subscriptionCount: 1,
        },
      });
      return;
    }
    submitted = route.request().postDataJSON() as {
      replacementCategoryId: string;
    };
    categories = [other];
    await route.fulfill({
      contentType: 'application/json',
      json: {
        deletedCategoryId: food.id,
        expenseCount: 2,
        replacement: other,
        subscriptionCount: 1,
      },
    });
  });

  await page.goto('/settings');
  const categoriesDisclosure = page.locator('details#categories');
  await categoriesDisclosure.locator('summary').click();
  await categoriesDisclosure
    .getByRole('button', { name: 'Delete Food & Dining' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Delete Food & Dining',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('2 expenses · 1 subscription')).toBeVisible();
  await expect(dialog.getByLabel('Move records to')).toHaveValue(other.id);
  await dialog.getByRole('button', { name: 'Reassign and delete' }).click();

  await expect(
    categoriesDisclosure.getByText(
      'Food & Dining deleted. 2 expenses and 1 subscription moved to Other.',
    ),
  ).toBeVisible();
  await expect(
    categoriesDisclosure.getByRole('button', {
      name: 'Delete Food & Dining',
    }),
  ).toHaveCount(0);
  expect(submitted).toEqual({ replacementCategoryId: other.id });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test('attachment storage can be configured for S3 or Cloudflare R2', async ({
  page,
}) => {
  let submitted:
    | {
        provider: string;
        s3: Record<string, unknown>;
      }
    | undefined;
  let configuration = {
    provider: 'local',
    s3: null as null | {
      bucket: string;
      endpoint: string | null;
      forcePathStyle: boolean;
      hasCredentials: boolean;
      prefix: string;
      region: string;
    },
    source: 'environment',
    updatedAt: null as string | null,
  };
  await page.unroute('**/api/attachment-storage');
  await page.route('**/api/attachment-storage', async (route) => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON() as typeof submitted;
      configuration = {
        provider: 's3',
        s3: {
          bucket: String(submitted?.s3.bucket),
          endpoint: String(submitted?.s3.endpoint),
          forcePathStyle: Boolean(submitted?.s3.forcePathStyle),
          hasCredentials: true,
          prefix: String(submitted?.s3.prefix),
          region: String(submitted?.s3.region),
        },
        source: 'settings',
        updatedAt: '2026-07-29T00:00:00.000Z',
      };
      await route.fulfill({
        contentType: 'application/json',
        json: { configuration },
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        allowedMimeTypes: ['application/pdf', 'image/jpeg'],
        availableProviders: ['local', 's3'],
        configuration,
        fileCount: 4,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20_971_520,
        provider: configuration.provider,
        providerLabel:
          configuration.provider === 'local'
            ? 'Local host folder'
            : 'S3-compatible storage',
        totalSizeBytes: 13_316_915,
      },
    });
  });
  await page.route('**/api/attachment-storage/test', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        message: 'The S3-compatible attachment destination is reachable.',
      },
    }),
  );

  await page.goto('/settings');
  const storage = page.locator('details#file-storage');
  await expect(
    storage.locator('button').filter({ hasText: 'Test connection' }),
  ).toBeAttached();
  await storage.locator('summary').click();
  await storage
    .locator('label.backup-choice')
    .filter({ hasText: 'S3 / Cloudflare R2' })
    .click();
  await storage.getByLabel('Bucket', { exact: true }).fill('private-receipts');
  await storage
    .getByLabel('Endpoint (optional for AWS)')
    .fill('https://account.r2.cloudflarestorage.com');
  await storage.getByLabel('Access key ID').fill('r2-access');
  await storage.getByLabel('Secret access key').fill('r2-secret');
  await storage.getByRole('button', { name: 'Test connection' }).click();
  await expect(
    storage.getByText('The S3-compatible attachment destination is reachable.'),
  ).toBeVisible();
  await storage.getByRole('button', { name: 'Save storage settings' }).click();

  expect(submitted).toMatchObject({
    provider: 's3',
    s3: {
      accessKeyId: 'r2-access',
      bucket: 'private-receipts',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      prefix: 'bizziemoney',
      region: 'auto',
      secretAccessKey: 'r2-secret',
    },
  });
  await expect(
    storage.getByRole('button', { name: 'Edit configuration' }),
  ).toBeVisible();
  await expect(storage.getByLabel('Access key ID')).toHaveValue(
    '**********************',
  );
  await expect(storage.getByLabel('Secret access key')).toHaveValue(
    '**********************',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test('portable export and password-confirmed purge are explicit and responsive', async ({
  page,
}) => {
  let purgeRequest:
    | {
        body: Record<string, string>;
        idempotencyKey: string | undefined;
      }
    | undefined;
  await page.route('**/api/data/export', (route) =>
    route.fulfill({
      body: Buffer.from('portable archive'),
      contentType: 'application/gzip',
      headers: {
        'content-disposition':
          'attachment; filename="bizziemoney-full-export-2026-07-29.tar.gz"',
      },
    }),
  );
  await page.route('**/api/data/purge', async (route) => {
    purgeRequest = {
      body: route.request().postDataJSON() as Record<string, string>,
      idempotencyKey: route.request().headers()['idempotency-key'],
    };
    await route.fulfill({
      contentType: 'application/json',
      json: {
        attachmentFilesQueued: 2,
        attachments: 1,
        completedAt: '2026-07-29T00:00:00.000Z',
        debtPayments: 1,
        debts: 1,
        expenses: 3,
        replayed: false,
        subscriptionPayments: 1,
        subscriptions: 1,
        tags: 1,
      },
    });
  });

  await page.goto('/settings');
  const dataManagement = page.locator('details#data-management');
  await expect(
    dataManagement.locator('button').filter({ hasText: 'Download export' }),
  ).toBeAttached();
  await dataManagement.locator('summary').click();
  await expect(dataManagement).toHaveAttribute('open', '');

  const downloadPromise = page.waitForEvent('download');
  await dataManagement.getByRole('button', { name: 'Download export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^bizziemoney-full-export-\d{4}-\d{2}-\d{2}\.tar\.gz$/,
  );
  await download.path();
  await download.delete();

  await dataManagement.getByRole('button', { name: 'Delete data…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete financial data' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Existing backups are not deleted.'),
  ).toBeVisible();
  const purgeButton = dialog.getByRole('button', {
    name: 'Permanently delete',
  });
  await expect(purgeButton).toBeDisabled();
  await dialog.getByLabel('Current password').fill('owner-password');
  await dialog
    .getByLabel(/Type DELETE ALL DATA to confirm/)
    .fill('delete all data');
  await expect(purgeButton).toBeDisabled();
  await dialog
    .getByLabel(/Type DELETE ALL DATA to confirm/)
    .fill('DELETE ALL DATA');
  await expect(purgeButton).toBeEnabled();
  await purgeButton.click();

  await expect(
    dataManagement.getByText(/Financial data was deleted/),
  ).toBeVisible();
  expect(purgeRequest?.body).toEqual({
    confirmation: 'DELETE ALL DATA',
    currentPassword: 'owner-password',
  });
  expect(purgeRequest?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test('regional preferences can be edited and persist after refresh', async ({
  page,
}) => {
  const currentPreferences = await mockOwnerPreferences(page, {
    ...defaultOwnerPreferences,
    timeZone: 'UTC',
  });

  await page.goto('/settings');
  const preferences = page.locator('details#regional-preferences');
  await preferences.locator('summary').click();
  await expect(preferences).toHaveAttribute('open', '');
  await preferences.getByRole('button', { name: 'Edit' }).click();
  await preferences.getByLabel('Default currency').fill('EUR');
  await preferences.getByLabel('Time zone').fill('Europe/Paris');
  await preferences.getByLabel('Number format').selectOption('1.234,56');
  await preferences.getByLabel('Date format').selectOption('dd/MM/yyyy');
  await preferences.getByLabel('First day of week').selectOption('1');
  await expect(preferences.getByTestId('number-format-preview')).toContainText(
    '1.234,56',
  );
  await expect(preferences.getByTestId('date-format-preview')).toHaveText(
    '28/07/2026',
  );
  await preferences.getByRole('button', { name: 'Save preferences' }).click();

  await expect(
    preferences.getByText('Regional preferences updated.'),
  ).toBeVisible();
  expect(currentPreferences()).toMatchObject({
    dateFormat: 'dd/MM/yyyy',
    defaultCurrency: 'EUR',
    firstDayOfWeek: 1,
    numberFormat: '1.234,56',
    timeZone: 'Europe/Paris',
  });

  await page.reload();
  await preferences.locator('summary').click();
  await expect(preferences.getByText('EUR', { exact: true })).toBeVisible();
  await expect(
    preferences.getByText('Europe/Paris', { exact: true }),
  ).toBeVisible();
});
