// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataManagement } from './DataManagement';

function renderDataManagement() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DataManagement />
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

describe('DataManagement', () => {
  it('keeps permanent deletion disabled until password and exact phrase are entered', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      void input;
      void init;
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            attachmentFilesQueued: 2,
            attachments: 1,
            completedAt: '2026-07-29T00:00:00.000Z',
            debtPayments: 0,
            debts: 0,
            expenses: 3,
            replayed: false,
            subscriptionPayments: 0,
            subscriptions: 0,
            tags: 1,
          }),
        ok: true,
        status: 200,
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDataManagement();

    fireEvent.click(screen.getByRole('button', { name: 'Delete data…' }));
    const submit = screen.getByRole('button', {
      name: 'Permanently delete',
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.change(screen.getByLabelText(/Type DELETE ALL DATA to confirm/), {
      target: { value: 'delete all data' },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type DELETE ALL DATA to confirm/), {
      target: { value: 'DELETE ALL DATA' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(
      await screen.findByText(/Financial data was deleted/),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('idempotency-key')).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toEqual({
      confirmation: 'DELETE ALL DATA',
      currentPassword: 'correct horse battery staple',
    });
  });

  it('downloads the portable archive without exposing a browser-facing API host', async () => {
    const blob = new Blob(['archive']);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          blob: () => Promise.resolve(blob),
          ok: true,
          status: 200,
        } as Response),
      ),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:portable-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    renderDataManagement();

    fireEvent.click(screen.getByRole('button', { name: 'Download export' }));

    expect(
      await screen.findByText('Your portable export was downloaded.'),
    ).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:portable-export');
  });
});
