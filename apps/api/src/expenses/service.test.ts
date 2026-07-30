import { describe, expect, it, vi } from 'vitest';

import { ExpenseService, normalizeTags } from './service.js';
import type { ExpenseStore } from './store.js';
import type { ExpenseRecord } from './types.js';

const expense: ExpenseRecord = {
  amount: '25.5000',
  attachmentCount: 0,
  category: {
    archived: false,
    color: '#16A36A',
    icon: 'utensils',
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Food & Dining',
  },
  createdAt: new Date('2026-07-27T08:00:00.000Z'),
  currencyCode: 'USD',
  date: '2026-07-27',
  description: '=SUM(A1:A2)',
  id: '00000000-0000-4000-8000-000000000005',
  merchant: null,
  notes: null,
  paymentMethod: {
    archived: false,
    icon: 'circle-ellipsis',
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Other',
  },
  tags: ['Lunch'],
  updatedAt: new Date('2026-07-27T08:00:00.000Z'),
};

function createStore(): ExpenseStore {
  return {
    createCategory: vi.fn(),
    createExpense: vi.fn(() =>
      Promise.resolve({
        expenseId: expense.id,
        mismatched: false,
        replayed: false,
      }),
    ),
    createPaymentMethod: vi.fn(),
    deleteCategory: vi.fn(() =>
      Promise.resolve({ status: 'source_not_found' as const }),
    ),
    deleteExpense: vi.fn(() => Promise.resolve(true)),
    getExpense: vi.fn(() => Promise.resolve(expense)),
    getImportContext: vi.fn(() =>
      Promise.resolve({
        defaultCurrency: 'USD',
        options: { categories: [], paymentMethods: [] },
      }),
    ),
    getCategoryDeletionPreview: vi.fn(() => Promise.resolve(null)),
    getOptions: vi.fn(() =>
      Promise.resolve({ categories: [], paymentMethods: [] }),
    ),
    getSummary: vi.fn(() =>
      Promise.resolve({
        count: 0,
        currencyGroups: [
          { categories: [], currencyCode: 'USD', totalAmount: '0' },
        ],
        defaultCurrency: 'USD',
      }),
    ),
    listExpenses: vi.fn(() =>
      Promise.resolve({ hasMore: false, items: [expense] }),
    ),
    importExpenses: vi.fn(),
    updateCategory: vi.fn(),
    updateExpense: vi.fn(() => Promise.resolve(true)),
    updatePaymentMethod: vi.fn(),
  };
}

describe('ExpenseService', () => {
  it('normalizes and deduplicates tags without losing display casing', () => {
    expect(normalizeTags([' Lunch ', 'lunch', 'Work', '', 'work '])).toEqual([
      'Lunch',
      'Work',
    ]);
  });

  it('rejects cursors issued for a different sort', async () => {
    const service = new ExpenseService(createStore());
    const cursor = Buffer.from(
      JSON.stringify({
        id: expense.id,
        sort: 'amount_desc',
        value: '25.5',
        version: 1,
      }),
    ).toString('base64url');

    await expect(
      service.listExpenses('owner-id', {
        cursor,
        limit: 25,
        sort: 'date_desc',
      }),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID', statusCode: 400 });
  });

  it('protects CSV text cells from spreadsheet formula execution', async () => {
    const service = new ExpenseService(createStore());
    let csv = '';
    for await (const chunk of service.exportExpenses('owner-id', {
      sort: 'date_desc',
    })) {
      csv += chunk;
    }

    expect(csv).toContain('"\'=SUM(A1:A2)"');
    expect(csv).toContain('"25.5000"');
  });

  it('requires a different active replacement before deleting a category', async () => {
    const store = createStore();
    const deleteCategory = vi.fn<ExpenseStore['deleteCategory']>();
    store.deleteCategory = deleteCategory;
    const service = new ExpenseService(store);

    await expect(
      service.deleteCategory(
        'owner-id',
        'session-id',
        expense.category.id,
        expense.category.id,
      ),
    ).rejects.toMatchObject({
      code: 'CATEGORY_REPLACEMENT_INVALID',
      statusCode: 400,
    });
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it('returns category usage and transactional reassignment counts', async () => {
    const store = createStore();
    store.getCategoryDeletionPreview = vi.fn(() =>
      Promise.resolve({
        category: expense.category,
        expenseCount: 2,
        replacements: [
          {
            archived: false,
            color: '#71717A',
            icon: 'circle-ellipsis',
            id: '00000000-0000-4000-8000-000000000009',
            name: 'Other',
          },
        ],
        subscriptionCount: 1,
      }),
    );
    const deleteCategory = vi.fn(() =>
      Promise.resolve({
        deletedCategoryId: expense.category.id,
        expenseCount: 2,
        replacement: {
          archived: false,
          color: '#71717A',
          icon: 'circle-ellipsis',
          id: '00000000-0000-4000-8000-000000000009',
          name: 'Other',
        },
        status: 'deleted' as const,
        subscriptionCount: 1,
      }),
    );
    store.deleteCategory = deleteCategory;
    const service = new ExpenseService(
      store,
      () => new Date('2026-07-29T08:00:00.000Z'),
    );

    await expect(
      service.getCategoryDeletionPreview('owner-id', expense.category.id),
    ).resolves.toMatchObject({ expenseCount: 2, subscriptionCount: 1 });
    await expect(
      service.deleteCategory(
        'owner-id',
        'session-id',
        expense.category.id,
        '00000000-0000-4000-8000-000000000009',
      ),
    ).resolves.toMatchObject({
      deletedCategoryId: expense.category.id,
      expenseCount: 2,
      subscriptionCount: 1,
    });
    expect(deleteCategory).toHaveBeenCalledWith({
      categoryId: expense.category.id,
      now: new Date('2026-07-29T08:00:00.000Z'),
      ownerId: 'owner-id',
      replacementCategoryId: '00000000-0000-4000-8000-000000000009',
      sessionId: 'session-id',
    });
  });

  it('does not call the store when any import row is invalid', async () => {
    const store = createStore();
    const importExpenses = vi.fn();
    store.getImportContext = vi.fn(() =>
      Promise.resolve({
        defaultCurrency: 'USD',
        options: {
          categories: [expense.category],
          paymentMethods: [expense.paymentMethod],
        },
      }),
    );
    store.importExpenses = importExpenses;
    const service = new ExpenseService(store);

    await expect(
      service.importExpenses(
        'owner-id',
        'session-id',
        '00000000-0000-4000-8000-000000000010',
        'Date,Description,Amount,Category\n2026-07-28,Good,10,Food & Dining\nnot-a-date,Bad,5,Food & Dining',
      ),
    ).rejects.toMatchObject({
      code: 'EXPENSE_IMPORT_INVALID',
      statusCode: 400,
    });
    expect(importExpenses).not.toHaveBeenCalled();
  });
});
