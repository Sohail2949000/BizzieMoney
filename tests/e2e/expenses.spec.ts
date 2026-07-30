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

test.beforeEach(async ({ page }) => {
  let expenses: Array<Record<string, unknown>> = [];
  const attachmentsByExpense = new Map<
    string,
    Array<Record<string, unknown>>
  >();

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
        allowedMimeTypes: [
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/webp',
          'text/plain',
          'text/csv',
        ],
        availableProviders: ['local'],
        fileCount: [...attachmentsByExpense.values()].flat().length,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20 * 1_048_576,
        provider: 'local',
        providerLabel: 'Local host folder',
        totalSizeBytes: 0,
      },
    }),
  );
  await page.route('**/api/attachments/*/thumbnail', (route) =>
    route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z9DwHwAGAAJ//lxhKwAAAABJRU5ErkJggg==',
        'base64',
      ),
      contentType: 'image/png',
    }),
  );
  await page.route('**/api/expenses/summary**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        count: expenses.length,
        currencyGroups: [
          {
            categories: [],
            currencyCode: 'USD',
            totalAmount: expenses
              .reduce((total, expense) => total + Number(expense.amount), 0)
              .toFixed(4),
          },
        ],
        defaultCurrency: 'USD',
        month: '2026-07',
        recent: expenses.slice(0, 5),
      },
    }),
  );
  await page.route(/\/api\/expenses(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = {
        ...body,
        attachmentCount: 0,
        category,
        createdAt: '2026-07-27T08:00:00.000Z',
        currencyCode: 'USD',
        id: `00000000-0000-4000-8000-${String(expenses.length + 5).padStart(
          12,
          '0',
        )}`,
        paymentMethod,
        updatedAt: '2026-07-27T08:00:00.000Z',
      };
      expenses = [created, ...expenses];
      await route.fulfill({
        contentType: 'application/json',
        json: created,
        status: 201,
      });
      return;
    }
    const url = new URL(request.url());
    const search = url.searchParams.get('search')?.toLowerCase();
    const items = search
      ? expenses.filter((expense) =>
          String(expense.description).toLowerCase().includes(search),
        )
      : expenses;
    await route.fulfill({
      contentType: 'application/json',
      json: { items, nextCursor: null },
    });
  });
  await page.route(/\/api\/expenses\/[^/?]+\/attachments$/, async (route) => {
    const request = route.request();
    const segments = new URL(request.url()).pathname.split('/');
    const expenseId = segments.at(-2)!;
    if (request.method() === 'POST') {
      const attachment = {
        checksumSha256: 'a'.repeat(64),
        createdAt: '2026-07-27T08:00:00.000Z',
        displayName: 'receipt.png',
        id: '00000000-0000-4000-8000-000000000099',
        mimeType: 'image/png',
        previewSupported: true,
        sizeBytes: 15,
        thumbnailAvailable: true,
        updatedAt: '2026-07-27T08:00:00.000Z',
      };
      attachmentsByExpense.set(expenseId, [attachment]);
      expenses = expenses.map((expense) =>
        expense.id === expenseId ? { ...expense, attachmentCount: 1 } : expense,
      );
      await route.fulfill({
        contentType: 'application/json',
        json: attachment,
        status: 201,
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: attachmentsByExpense.get(expenseId) ?? [],
    });
  });
  await page.route(
    /\/api\/expenses\/(?!summary(?:\?|$)|export\.csv(?:\?|$))[^/?]+$/,
    async (route) => {
      const request = route.request();
      const expenseId = request.url().split('/').at(-1)!;
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as Record<string, unknown>;
        const index = expenses.findIndex((expense) => expense.id === expenseId);
        const updated = {
          ...expenses[index],
          ...body,
          category,
          paymentMethod,
          updatedAt: '2026-07-27T09:00:00.000Z',
        };
        expenses[index] = updated;
        await route.fulfill({ contentType: 'application/json', json: updated });
        return;
      }
      if (request.method() === 'DELETE') {
        expenses = expenses.filter((expense) => expense.id !== expenseId);
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ status: 404 });
    },
  );
  await page.route('**/api/expenses/import/preview', async (route) => {
    const { csvText } = route.request().postDataJSON() as { csvText: string };
    const invalid = csvText.includes('not-a-date');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        errorCount: invalid ? 1 : 0,
        rows: invalid
          ? [
              {
                amount: '8.00',
                categoryId: category.id,
                categoryName: category.name,
                currencyCode: 'USD',
                date: 'not-a-date',
                description: 'Bad date',
                errors: [
                  {
                    field: 'date',
                    message: 'Use a real date in YYYY-MM-DD format.',
                  },
                ],
                merchant: null,
                notes: null,
                paymentMethodId: paymentMethod.id,
                paymentMethodName: paymentMethod.name,
                rowNumber: 2,
                tags: [],
                valid: false,
              },
            ]
          : [
              {
                amount: '8.00',
                categoryId: category.id,
                categoryName: category.name,
                currencyCode: 'USD',
                date: '2026-07-28',
                description: 'Imported coffee',
                errors: [],
                merchant: 'Corner cafe',
                notes: null,
                paymentMethodId: paymentMethod.id,
                paymentMethodName: paymentMethod.name,
                rowNumber: 2,
                tags: ['imported'],
                valid: true,
              },
              {
                amount: '14.50',
                categoryId: category.id,
                categoryName: category.name,
                currencyCode: 'EUR',
                date: '2026-07-29',
                description: 'Imported lunch',
                errors: [],
                merchant: null,
                notes: null,
                paymentMethodId: paymentMethod.id,
                paymentMethodName: paymentMethod.name,
                rowNumber: 3,
                tags: [],
                valid: true,
              },
            ],
        totalRows: invalid ? 1 : 2,
        validCount: invalid ? 0 : 2,
      },
    });
  });
  await page.route('**/api/expenses/import', async (route) => {
    const imported = [
      {
        amount: '8.00',
        attachmentCount: 0,
        category,
        createdAt: '2026-07-28T08:00:00.000Z',
        currencyCode: 'USD',
        date: '2026-07-28',
        description: 'Imported coffee',
        id: '00000000-0000-4000-8000-000000000701',
        merchant: 'Corner cafe',
        notes: null,
        paymentMethod,
        tags: ['imported'],
        updatedAt: '2026-07-28T08:00:00.000Z',
      },
      {
        amount: '14.50',
        attachmentCount: 0,
        category,
        createdAt: '2026-07-29T08:00:00.000Z',
        currencyCode: 'EUR',
        date: '2026-07-29',
        description: 'Imported lunch',
        id: '00000000-0000-4000-8000-000000000702',
        merchant: null,
        notes: null,
        paymentMethod,
        tags: [],
        updatedAt: '2026-07-29T08:00:00.000Z',
      },
    ];
    expenses = [...imported, ...expenses];
    await route.fulfill({
      contentType: 'application/json',
      json: {
        currencyCounts: { EUR: 1, USD: 1 },
        importedCount: 2,
        replayed: false,
      },
      status: 201,
    });
  });
});

test('expense CRUD and server search stay usable across viewports', async ({
  page,
}) => {
  await page.goto('/expenses');
  await expect(
    page.getByRole('heading', { name: 'Expenses', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Add your first expense when you are ready.',
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Add expense' }).first().click();
  await page.getByLabel('Amount').fill('18.50');
  await page.getByLabel('Description').fill('Lunch');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(
    page.getByText('Lunch', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.expense-table tbody tr, .expense-card')
      .filter({ hasText: 'Lunch', visible: true }),
  ).toContainText('$18.50');

  await page
    .getByRole('button', { name: 'Edit Lunch' })
    .filter({ visible: true })
    .click();
  await page.getByLabel('Description').fill('Team lunch');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Team lunch', { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  await page.getByLabel('Search expenses').fill('missing');
  await expect(
    page.getByRole('heading', { name: 'No expenses match these filters.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByText('Team lunch', { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete Team lunch' })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Add your first expense when you are ready.',
    }),
  ).toBeVisible();
});

test('an attachment uploads with progress and appears on the saved expense', async ({
  page,
}) => {
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  await page.getByLabel('Amount').fill('12.00');
  await page.getByLabel('Description').fill('Parking');
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z9DwHwAGAAJ//lxhKwAAAABJRU5ErkJggg==',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'receipt.png',
  });
  await expect(page.getByText('Ready to upload')).toBeVisible();

  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(
    page
      .locator('.expense-table tbody tr, .expense-card')
      .filter({ hasText: 'Parking', visible: true }),
  ).toContainText('1');

  await page
    .getByRole('button', { name: 'Edit Parking' })
    .filter({ visible: true })
    .click();
  await expect(page.getByText('receipt.png', { exact: true })).toBeVisible();
  await expect(
    page.locator('.attachment-item__visual--thumbnail img'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Preview receipt.png' }),
  ).toHaveAttribute('target', '_blank');
});

test('CSV import previews errors and commits mixed currencies across viewports', async ({
  page,
}) => {
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import CSV' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Choose expense CSV').setInputFiles({
    buffer: Buffer.from('Date,Description,Amount\nnot-a-date,Bad date,8.00'),
    mimeType: 'text/csv',
    name: 'invalid-expenses.csv',
  });
  await expect(dialog.getByText('1 to fix')).toBeVisible();
  await expect(
    dialog.getByText('Use a real date in YYYY-MM-DD format.'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Import 0 expenses' }),
  ).toBeDisabled();

  await dialog.getByLabel('Choose expense CSV').setInputFiles({
    buffer: Buffer.from(
      [
        'Date,Description,Amount,Currency,Category',
        '2026-07-28,Imported coffee,8.00,USD,Food & Dining',
        '2026-07-29,Imported lunch,14.50,EUR,Food & Dining',
      ].join('\n'),
    ),
    mimeType: 'text/csv',
    name: 'valid-expenses.csv',
  });
  await expect(dialog.getByText('Ready to import')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 expenses' }).click();
  await expect(dialog.getByText('2 expenses imported')).toBeVisible();
  await expect(dialog.getByText('1 EUR · 1 USD')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(
    page
      .getByText('Imported coffee', { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Imported lunch', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});
