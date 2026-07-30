import { expect, test } from '@playwright/test';

import { mockOwnerPreferences } from './preferences';

interface MockDebt {
  attachmentCount: number;
  createdAt: string;
  currencyCode: string;
  customIntervalDays: number | null;
  direction: 'i_owe' | 'owed_to_me';
  dueDate: string | null;
  id: string;
  installmentAmount: string | null;
  installmentFrequency:
    | 'custom'
    | 'monthly'
    | 'quarterly'
    | 'semiannual'
    | 'weekly'
    | 'yearly'
    | null;
  interestNote: string | null;
  name: string;
  nextPaymentDate: string | null;
  notes: string | null;
  originalAmount: string;
  overpaidAmount: string;
  paidAmount: string;
  remainingAmount: string;
  startDate: string;
  status: 'active' | 'cancelled' | 'overdue' | 'paid' | 'paused';
  updatedAt: string;
}

interface MockDebtPayment {
  amount: string;
  attachmentCount: number;
  createdAt: string;
  currencyCode: string;
  debtId: string;
  debtName: string;
  id: string;
  notes: string | null;
  paymentDate: string;
  updatedAt: string;
}

const owner = {
  displayName: 'Jamie',
  email: 'jamie@example.com',
  id: '00000000-0000-4000-8000-000000000001',
};
const createdAt = '2026-07-29T08:00:00.000Z';

function money(value: number): string {
  return value.toFixed(4);
}

test.beforeEach(async ({ page }) => {
  let debts: MockDebt[] = [];
  let payments: MockDebtPayment[] = [];
  let nextDebtId = 10;
  let nextPaymentId = 100;

  const findDebt = (debtId: string) =>
    debts.find((candidate) => candidate.id === debtId);
  const updateDebt = (debtId: string, update: Partial<MockDebt>) => {
    const current = findDebt(debtId);
    if (!current) return null;
    const saved = { ...current, ...update, updatedAt: createdAt };
    debts = debts.map((candidate) =>
      candidate.id === debtId ? saved : candidate,
    );
    return saved;
  };

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
  await page.route('**/api/attachment-storage', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        allowedMimeTypes: ['application/pdf', 'image/png'],
        availableProviders: ['local'],
        configuration: {
          provider: 'local',
          s3: null,
          source: 'environment',
          updatedAt: null,
        },
        fileCount: 0,
        malwareScanner: 'not-configured',
        maxUploadSizeBytes: 20_971_520,
        provider: 'local',
        providerLabel: 'Local host folder',
        totalSizeBytes: 0,
      },
    }),
  );
  await page.route(/\/api\/debts\/[^/?]+\/attachments$/, (route) =>
    route.fulfill({ contentType: 'application/json', json: [] }),
  );
  await page.route(/\/api\/debt-payments\/[^/?]+\/attachments$/, (route) =>
    route.fulfill({ contentType: 'application/json', json: [] }),
  );
  await page.route('**/api/debts/summary', (route) => {
    const totals = debts.reduce(
      (current, debt) => {
        if (debt.status !== 'cancelled') {
          current[debt.direction] += Number(debt.remainingAmount);
        }
        return current;
      },
      { i_owe: 0, owed_to_me: 0 },
    );
    const hasDebt = debts.some((debt) => debt.status !== 'cancelled');
    return route.fulfill({
      contentType: 'application/json',
      json: {
        currencyGroups: hasDebt
          ? [
              {
                currencyCode: 'USD',
                iOwe: money(totals.i_owe),
                owedToMe: money(totals.owed_to_me),
              },
            ]
          : [],
        defaultCurrency: 'USD',
      },
    });
  });
  await page.route('**/api/debts/upcoming**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: { items: [], overdueCount: 0 },
    }),
  );
  await page.route(
    /\/api\/debts\/([^/?]+)\/(cancel|complete|pause|reopen|resume)$/,
    async (route) => {
      const match = new URL(route.request().url()).pathname.match(
        /\/api\/debts\/([^/]+)\/([^/]+)$/,
      );
      const debtId = match?.[1] ?? '';
      const action = match?.[2];
      const current = findDebt(debtId);
      if (!current) {
        await route.fulfill({ status: 404 });
        return;
      }
      const status =
        action === 'pause'
          ? 'paused'
          : action === 'cancel'
            ? 'cancelled'
            : action === 'complete'
              ? 'paid'
              : 'active';
      const saved = updateDebt(debtId, {
        remainingAmount:
          action === 'complete'
            ? '0.0000'
            : action === 'reopen'
              ? money(
                  Number(current.originalAmount) - Number(current.paidAmount),
                )
              : current.remainingAmount,
        status,
      });
      await route.fulfill({ contentType: 'application/json', json: saved });
    },
  );
  await page.route(
    /\/api\/debts\/([^/?]+)\/payments(?:\?.*)?$/,
    async (route) => {
      const match = new URL(route.request().url()).pathname.match(
        /\/api\/debts\/([^/]+)\/payments$/,
      );
      const debtId = match?.[1] ?? '';
      const debt = findDebt(debtId);
      if (!debt) {
        await route.fulfill({ status: 404 });
        return;
      }
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as {
          amount: string;
          notes: string | null;
          paymentDate: string;
        };
        const amount = Number(input.amount);
        const paidAmount = Number(debt.paidAmount) + amount;
        updateDebt(debtId, {
          paidAmount: money(paidAmount),
          remainingAmount: money(
            Math.max(0, Number(debt.originalAmount) - paidAmount),
          ),
          status:
            paidAmount >= Number(debt.originalAmount) ? 'paid' : debt.status,
        });
        const payment: MockDebtPayment = {
          amount: money(amount),
          attachmentCount: 0,
          createdAt,
          currencyCode: debt.currencyCode,
          debtId,
          debtName: debt.name,
          id: `00000000-0000-4000-8000-${String(nextPaymentId++).padStart(
            12,
            '0',
          )}`,
          notes: input.notes,
          paymentDate: input.paymentDate,
          updatedAt: createdAt,
        };
        payments = [payment, ...payments];
        await route.fulfill({
          contentType: 'application/json',
          json: payment,
          status: 201,
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        json: {
          items: payments.filter((payment) => payment.debtId === debtId),
          nextCursor: null,
        },
      });
    },
  );
  await page.route(/\/api\/debts\/([0-9a-f-]{36})$/, async (route) => {
    const debtId =
      new URL(route.request().url()).pathname.match(
        /\/api\/debts\/([0-9a-f-]{36})$/,
      )?.[1] ?? '';
    const debt = findDebt(debtId);
    if (!debt) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON() as Partial<MockDebt>;
      const saved = updateDebt(debtId, {
        ...input,
        remainingAmount: money(
          Number(input.originalAmount ?? debt.originalAmount) -
            Number(debt.paidAmount),
        ),
      });
      await route.fulfill({ contentType: 'application/json', json: saved });
      return;
    }
    if (route.request().method() === 'DELETE') {
      debts = debts.filter((candidate) => candidate.id !== debtId);
      payments = payments.filter((payment) => payment.debtId !== debtId);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ contentType: 'application/json', json: debt });
  });
  await page.route(/\/api\/debts(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as Omit<
        MockDebt,
        | 'attachmentCount'
        | 'createdAt'
        | 'currencyCode'
        | 'id'
        | 'overpaidAmount'
        | 'paidAmount'
        | 'remainingAmount'
        | 'status'
        | 'updatedAt'
      >;
      const originalAmount = money(Number(input.originalAmount));
      const debt: MockDebt = {
        ...input,
        attachmentCount: 0,
        createdAt,
        currencyCode: 'USD',
        id: `00000000-0000-4000-8000-${String(nextDebtId++).padStart(12, '0')}`,
        originalAmount,
        overpaidAmount: '0.0000',
        paidAmount: '0.0000',
        remainingAmount: originalAmount,
        status: 'active',
        updatedAt: createdAt,
      };
      debts = [debt, ...debts];
      await route.fulfill({
        contentType: 'application/json',
        json: debt,
        status: 201,
      });
      return;
    }

    const url = new URL(route.request().url());
    const direction = url.searchParams.get('direction');
    const search = url.searchParams.get('search')?.toLowerCase();
    const status = url.searchParams.get('status');
    const items = debts.filter(
      (debt) =>
        debt.direction === direction &&
        (!search ||
          debt.name.toLowerCase().includes(search) ||
          debt.notes?.toLowerCase().includes(search)) &&
        (!status || debt.status === status),
    );
    await route.fulfill({
      contentType: 'application/json',
      json: { items, nextCursor: null },
    });
  });
});

test('debt creation, editing, status, payment, direction, and deletion stay usable', async ({
  page,
}) => {
  await page.goto('/debts');
  await expect(
    page.getByRole('heading', { name: 'Money owed', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Add the first amount you owe when you are ready.',
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Add loan or debt' }).first().click();
  const addDialog = page.getByRole('dialog', { name: 'Add loan or debt' });
  await addDialog.getByLabel('Person, company, or lender').fill('Auto loan');
  await addDialog.getByLabel('Original amount').fill('1000');
  await addDialog.getByLabel('Start date').fill('2026-07-01');
  await addDialog.getByLabel('Final due date (optional)').fill('2026-12-31');
  await addDialog.getByRole('button', { name: 'Save loan or debt' }).click();

  await expect(
    page.getByText('Auto loan', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Debt totals' })).toContainText(
    '$1,000.00',
  );

  await page
    .getByRole('button', { name: 'Pause Auto loan' })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByRole('button', { name: 'Resume Auto loan' })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Resume Auto loan' })
    .filter({ visible: true })
    .click();

  await page
    .getByRole('button', { name: 'Edit Auto loan' })
    .filter({ visible: true })
    .click();
  const editDialog = page.getByRole('dialog', { name: 'Edit loan or debt' });
  await editDialog.getByLabel('Person, company, or lender').fill('Car loan');
  await editDialog.getByRole('button', { name: 'Save loan or debt' }).click();
  await expect(
    page.getByText('Car loan', { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Payment history for Car loan' })
    .filter({ visible: true })
    .click();
  const paymentDialog = page.getByRole('dialog', { name: 'Car loan' });
  await paymentDialog.getByLabel('Payment date').fill('2026-07-29');
  await paymentDialog.getByLabel('Amount').fill('200');
  await paymentDialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(paymentDialog).toContainText('$200.00');
  await expect(paymentDialog).toContainText('$800.00');
  await paymentDialog
    .getByRole('button', { name: 'Close', exact: true })
    .click();

  await page.getByLabel('Search loans and debts').fill('missing');
  await expect(
    page.getByRole('heading', { name: 'No records match these filters.' }),
  ).toBeVisible();
  await page.getByLabel('Search loans and debts').fill('');
  await expect(
    page.getByText('Car loan', { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  await page
    .getByRole('tab', { name: 'Money owed to me', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Add the first amount owed to you when you are ready.',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add loan or debt' }).first().click();
  const receivableDialog = page.getByRole('dialog', {
    name: 'Add loan or debt',
  });
  await receivableDialog
    .getByLabel('Person, company, or lender')
    .fill('Client reimbursement');
  await receivableDialog.getByLabel('Original amount').fill('500');
  await receivableDialog.getByLabel('Start date').fill('2026-07-15');
  await receivableDialog
    .getByRole('button', { name: 'Save loan or debt' })
    .click();

  const totals = page.getByRole('region', { name: 'Debt totals' });
  await expect(totals).toContainText('$800.00');
  await expect(totals).toContainText('$500.00');
  await expect(
    page
      .getByText('Client reimbursement', { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Delete Client reimbursement' })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Add the first amount owed to you when you are ready.',
    }),
  ).toBeVisible();
});
