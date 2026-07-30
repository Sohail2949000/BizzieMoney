import { expect, test } from '@playwright/test';

import { mockOwnerPreferences } from './preferences';

const category = {
  archived: false,
  color: '#16A36A',
  icon: 'utensils',
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Food & Dining',
};
const paymentMethod = {
  archived: false,
  icon: 'circle-ellipsis',
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Other',
};
const backupArtifact = {
  applicationVersion: '0.8.0',
  attachmentCount: 4,
  backupCreatedAt: '2026-07-28T09:15:03.000Z',
  checksumSha256: 'a'.repeat(64),
  encrypted: false,
  fileName: 'BizzieMoney-20260728T091503Z.bzm',
  id: '00000000-0000-4000-8000-000000000005',
  includesAttachments: true,
  schemaVersion: 9,
  sizeBytes: '13107200',
  storageProvider: 'local',
};
const previewJob = {
  createdAt: '2026-07-28T09:16:00.000Z',
  errorMessage: null,
  finishedAt: '2026-07-28T09:16:01.000Z',
  id: '00000000-0000-4000-8000-000000000006',
  kind: 'preview',
  progressPercent: 100,
  progressStage: 'Preview ready',
  startedAt: '2026-07-28T09:16:00.000Z',
  status: 'succeeded',
  triggerType: 'manual',
};
const restorePreview = {
  artifactId: backupArtifact.id,
  createdAt: '2026-07-28T09:16:00.000Z',
  expiresAt: '2026-07-28T09:31:00.000Z',
  id: '00000000-0000-4000-8000-000000000007',
  job: previewJob,
  status: 'ready',
  summary: {
    applicationVersion: '0.8.0',
    attachmentCount: 4,
    backupCreatedAt: backupArtifact.backupCreatedAt,
    encrypted: false,
    includesAttachments: true,
    schemaVersion: 9,
    tables: { debts: 2, expenses: 6, subscriptions: 2 },
    warnings: [],
  },
  usedAt: null,
};

test.beforeEach(async ({ page }) => {
  let expenseRequests = 0;
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
  await page.route('**/api/expense-options**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { categories: [category], paymentMethods: [paymentMethod] },
    }),
  );
  await page.route('**/api/expenses/summary**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        count: 0,
        currencyGroups: [
          {
            categories: [],
            currencyCode: 'USD',
            totalAmount: '0.0000',
          },
        ],
        defaultCurrency: 'USD',
        month: '2026-07',
        recent: [],
      },
    }),
  );
  await page.route(/\/api\/expenses(?:\?.*)?$/, (route) => {
    expenseRequests += 1;
    if (expenseRequests <= 2) {
      return route.fulfill({
        contentType: 'application/json',
        json: {
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Expenses are temporarily unavailable.',
            requestId: 'hardening-request',
          },
        },
        status: 503,
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      json: { items: [], nextCursor: null },
    });
  });
});

test('error recovery, modal focus, and the 320px layout remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ height: 720, width: 320 });
  await page.goto('/expenses');

  await expect(
    page.getByRole('heading', { name: 'Expenses could not be loaded.' }),
  ).toBeVisible();
  const retryButton = page.getByRole('button', { name: 'Try again' });
  await expect(retryButton).toBeVisible();
  await expect
    .poll(() =>
      retryButton.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height),
      ),
    )
    .toBeGreaterThanOrEqual(44);

  await retryButton.click();
  await expect(
    page.getByRole('heading', {
      name: 'Add your first expense when you are ready.',
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add expense' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('restore preview is centered, traps focus, and closes with Escape', async ({
  page,
}) => {
  await page.route('**/api/auth/sessions', (route) =>
    route.fulfill({ contentType: 'application/json', json: { sessions: [] } }),
  );
  await page.route('**/api/attachment-storage', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        allowedMimeTypes: ['application/pdf'],
        availableProviders: ['local', 's3'],
        fileCount: 0,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20_971_520,
        provider: 'local',
        providerLabel: 'Local host folder',
        totalSizeBytes: 0,
      },
    }),
  );
  await page.route('**/api/backups/config', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { config: null },
    }),
  );
  await page.route('**/api/backups/history', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { artifacts: [backupArtifact], jobs: [] },
    }),
  );
  await page.route(
    `**/api/backups/artifacts/${backupArtifact.id}/preview`,
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        json: restorePreview,
      }),
  );
  await page.route(`**/api/backups/previews/${restorePreview.id}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: restorePreview,
    }),
  );

  await page.goto('/settings#backups');
  await page.getByRole('button', { name: 'Preview restore' }).click();

  const dialog = page.getByRole('dialog', { name: 'Restore preview' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  const position = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      horizontal: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      vertical: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
    };
  });
  expect(position.horizontal).toBeLessThanOrEqual(10);
  expect(position.vertical).toBeLessThanOrEqual(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
