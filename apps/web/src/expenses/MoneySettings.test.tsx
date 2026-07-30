// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoneySettings } from './MoneySettings';

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
const paymentMethod = {
  archived: false,
  icon: 'banknote',
  id: '00000000-0000-4000-8000-000000000004',
  name: 'Cash',
};

function renderMoneySettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MoneySettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

describe('MoneySettings category deletion', () => {
  it('previews usage and requires a replacement before deleting', async () => {
    let deleted = false;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = init?.method ?? 'GET';
      const json =
        method === 'DELETE'
          ? {
              deletedCategoryId: food.id,
              expenseCount: 2,
              replacement: other,
              subscriptionCount: 1,
            }
          : url.includes('/deletion-preview')
            ? {
                category: food,
                expenseCount: 2,
                replacements: [other],
                subscriptionCount: 1,
              }
            : {
                categories: deleted ? [other] : [food, other],
                paymentMethods: [paymentMethod],
              };
      if (method === 'DELETE') deleted = true;
      return Promise.resolve({
        json: () => Promise.resolve(json),
        ok: true,
        status: 200,
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMoneySettings();

    const details = (await screen.findByText('Categories')).closest('details');
    if (!details) throw new Error('Categories disclosure was not rendered.');
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const deleteButton = await screen.findByRole('button', {
      name: 'Delete Food & Dining',
    });
    fireEvent.click(deleteButton);

    expect(
      await screen.findByText('2 expenses · 1 subscription'),
    ).toBeVisible();
    expect(screen.getByLabelText(/Move records to/)).toHaveValue(other.id);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reassign and delete' }),
    );

    expect(
      await screen.findByText(
        'Food & Dining deleted. 2 expenses and 1 subscription moved to Other.',
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Delete Food & Dining' }),
      ).not.toBeInTheDocument(),
    );
    const deleteCall = fetchMock.mock.calls.find(
      ([, request]) => request?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
    const deleteBody = deleteCall?.[1]?.body;
    expect(typeof deleteBody).toBe('string');
    expect(JSON.parse(deleteBody as string)).toEqual({
      replacementCategoryId: other.id,
    });
  });
});
