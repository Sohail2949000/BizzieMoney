// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpenseImportDialog } from './ExpenseImportDialog';

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExpenseImportDialog onClose={vi.fn()} open />
    </QueryClientProvider>,
  );
}

function csvFile(csvText: string): File {
  const file = new File([csvText], 'expenses.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(csvText),
  });
  return file;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

describe('ExpenseImportDialog', () => {
  it('previews a valid file and commits it after confirmation', async () => {
    const fetchMock = vi.fn((...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const payload = url.endsWith('/preview')
        ? {
            errorCount: 0,
            rows: [
              {
                amount: '4.25',
                categoryId: 'category-id',
                categoryName: 'Other',
                currencyCode: 'USD',
                date: '2026-07-28',
                description: 'Coffee',
                errors: [],
                merchant: null,
                notes: null,
                paymentMethodId: 'payment-id',
                paymentMethodName: 'Other',
                rowNumber: 2,
                tags: [],
                valid: true,
              },
            ],
            totalRows: 1,
            validCount: 1,
          }
        : {
            currencyCounts: { USD: 1 },
            importedCount: 1,
            replayed: false,
          };
      return Promise.resolve({
        json: () => Promise.resolve(payload),
        ok: true,
        status: url.endsWith('/preview') ? 200 : 201,
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Choose expense CSV'), {
      target: {
        files: [csvFile('Date,Description,Amount\n2026-07-28,Coffee,4.25')],
      },
    });

    expect(await screen.findByText('1 row checked')).toBeInTheDocument();
    const importButton = screen.getByRole('button', {
      name: 'Import 1 expense',
    });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);

    expect(await screen.findByText('1 expense imported')).toBeInTheDocument();
    expect(screen.getByText('1 USD')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const commitInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(new Headers(commitInit.headers).get('idempotency-key')).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it('keeps commit disabled when the preview contains errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              errorCount: 1,
              rows: [
                {
                  amount: '0',
                  categoryId: null,
                  categoryName: 'Other',
                  currencyCode: 'USD',
                  date: 'bad',
                  description: '',
                  errors: [
                    {
                      field: 'date',
                      message: 'Use a real date in YYYY-MM-DD format.',
                    },
                  ],
                  merchant: null,
                  notes: null,
                  paymentMethodId: 'payment-id',
                  paymentMethodName: 'Other',
                  rowNumber: 2,
                  tags: [],
                  valid: false,
                },
              ],
              totalRows: 1,
              validCount: 0,
            }),
          ok: true,
          status: 200,
        } as Response),
      ),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText('Choose expense CSV'), {
      target: {
        files: [csvFile('Date,Description,Amount\nbad,,0')],
      },
    });

    expect(await screen.findByText('1 to fix')).toBeInTheDocument();
    expect(
      screen.getByText('Use a real date in YYYY-MM-DD format.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Import 0 expenses' }),
    ).toBeDisabled();
  });
});
