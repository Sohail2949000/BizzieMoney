// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapState } from './api/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';

const authenticatedState: BootstrapState = {
  authenticated: true,
  owner: {
    displayName: 'Jamie',
    email: 'jamie@example.com',
    id: '00000000-0000-4000-8000-000000000001',
  },
  sessionExpiresAt: '2026-08-03T08:00:00.000Z',
  setupRequired: false,
};

function mockBootstrap(state: BootstrapState): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      let payload: unknown = state;
      if (url.includes('/api/auth/sessions')) {
        payload = { sessions: [] };
      } else if (url.includes('/api/settings/preferences')) {
        payload = {
          dateFormat: 'MMM d, yyyy',
          defaultCurrency: 'USD',
          firstDayOfWeek: 0,
          numberFormat: '1,234.56',
          timeZone: 'Asia/Riyadh',
          updatedAt: '2026-07-28T10:00:00.000Z',
        };
      } else if (url.includes('/api/expenses/summary')) {
        payload = {
          count: 0,
          currencyGroups: [
            {
              categories: [],
              currencyCode: 'USD',
              totalAmount: '0',
            },
          ],
          defaultCurrency: 'USD',
          month: '2026-07',
          recent: [],
        };
      } else if (url.includes('/api/backups/status')) {
        payload = {
          activeJob: null,
          config: null,
          configured: false,
          lastSuccessfulBackup: null,
          worker: { lastSeenAt: null, status: 'unknown' },
        };
      } else if (url.includes('/api/backups/config')) {
        payload = { config: null };
      } else if (url.includes('/api/backups/history')) {
        payload = { artifacts: [], jobs: [] };
      } else if (url.includes('/api/attachment-storage')) {
        payload = {
          allowedMimeTypes: ['application/pdf', 'text/plain'],
          availableProviders: ['local'],
          fileCount: 0,
          malwareScanner: 'not-configured',
          maxUploadSizeBytes: 20 * 1_048_576,
          provider: 'local',
          providerLabel: 'Local host folder',
          totalSizeBytes: 0,
        };
      } else if (url.includes('/api/debts/summary')) {
        payload = {
          currencyGroups: [{ currencyCode: 'USD', iOwe: '0', owedToMe: '0' }],
          defaultCurrency: 'USD',
        };
      } else if (url.includes('/api/debts/upcoming')) {
        payload = { items: [], overdueCount: 0 };
      } else if (url.includes('/api/debts')) {
        payload = { items: [], nextCursor: null };
      } else if (url.includes('/api/expense-options')) {
        payload = {
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
        };
      } else if (url.includes('/api/subscriptions/upcoming')) {
        payload = { dueSoonCount: 0, items: [], overdueCount: 0 };
      } else if (url.includes('/api/subscription-reminders')) {
        payload = [];
      } else if (url.includes('/api/subscriptions')) {
        payload = { items: [], nextCursor: null };
      } else if (url.includes('/api/expenses')) {
        payload = { items: [], nextCursor: null };
      }
      return Promise.resolve({
        json: () => Promise.resolve(payload),
        ok: true,
        status: 200,
      } as Response);
    }),
  );
}

function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function requestedUrls(): string[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) =>
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input,
    );
}

beforeEach(() => {
  mockBootstrap(authenticatedState);
});

describe('BizzieMoney Phase 6 shell', () => {
  it('renders the authenticated truthful overview with no demo amounts', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', {
        name: 'Your money, minus the noise.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Welcome, Jamie\./)).toBeInTheDocument();
    expect(
      Array.from(
        screen
          .getAllByLabelText('BizzieMoney overview')[0]!
          .querySelectorAll('img'),
        (image) => image.getAttribute('src'),
      ),
    ).toEqual([
      '/brand/bizziemoney-app-light-display.png',
      '/brand/bizziemoney-app-dark-display.png',
    ]);
    expect(screen.getAllByText('No data yet')).toHaveLength(4);
    expect(screen.queryByText('$1,250.00')).not.toBeInTheDocument();
  });

  it('opens the working expense module with a truthful empty state', async () => {
    renderApp();

    const expenseLinks = await screen.findAllByRole('link', {
      name: 'Expenses',
    });
    fireEvent.click(expenseLinks[0]!);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Expenses' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: 'Add your first expense when you are ready.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Add expense' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('July 2026').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect((await screen.findAllByText('June 2026')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        requestedUrls().some(
          (url) =>
            url.includes('/api/expenses?') &&
            url.includes('dateFrom=2026-06-01') &&
            url.includes('dateTo=2026-06-30'),
        ),
      ).toBe(true);
    });
  });

  it('opens the working subscriptions module with no seeded renewals', async () => {
    renderApp('/subscriptions');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Subscriptions',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: 'Add your first subscription when you are ready.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Add subscription' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Subscription month')).toHaveTextContent(
      'July 2026',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => {
      expect(
        requestedUrls().some(
          (url) =>
            url.includes('/api/subscriptions?') &&
            url.includes('dateFrom=2026-06-01') &&
            url.includes('dateTo=2026-06-30'),
        ),
      ).toBe(true);
    });
  });

  it('opens the working money owed module with beginner-friendly tabs', async () => {
    renderApp('/debts');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Money owed',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Money I owe' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('tab', { name: 'Money owed to me' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: 'Add the first amount you owe when you are ready.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Loans and debts month')).toHaveTextContent(
      'July 2026',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => {
      expect(
        requestedUrls().some(
          (url) =>
            url.includes('/api/debts?') &&
            url.includes('dateFrom=2026-06-01') &&
            url.includes('dateTo=2026-06-30'),
        ),
      ).toBe(true);
    });
  });

  it('applies an explicit dark appearance preference', async () => {
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Use dark appearance',
      }),
    );

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps detailed settings collapsed until requested and opens owner editing', async () => {
    renderApp('/settings');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Settings' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      for (const id of [
        'owner-account',
        'regional-preferences',
        'appearance',
        'categories',
        'payment-methods',
        'file-storage',
        'backups',
        'change-password',
        'active-sessions',
      ]) {
        expect(document.querySelector(`#${id}`)).not.toHaveAttribute('open');
      }
    });

    fireEvent.click(
      screen
        .getByRole('heading', { name: 'Owner account' })
        .closest('summary')!,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(screen.getByLabelText('Name')).toHaveValue('Jamie');
    expect(screen.getByLabelText('Email')).toHaveValue('jamie@example.com');
    expect(
      document.querySelector('#owner-current-password'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    expect(
      document.querySelector('#owner-current-password'),
    ).not.toBeInTheDocument();
  });

  it('opens regional preferences with stable previews', async () => {
    renderApp('/settings');

    expect(
      await screen.findByRole('heading', {
        name: 'Regional preferences',
      }),
    ).toBeInTheDocument();
    const regionalDetails = screen
      .getByRole('heading', { name: 'Regional preferences' })
      .closest('details');
    fireEvent.click(regionalDetails!.querySelector('summary')!);
    fireEvent.click(regionalDetails!.querySelector('button')!);

    expect(screen.getByLabelText('Default currency')).toHaveValue('USD');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Riyadh');
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    expect(screen.getByText('Jul 28, 2026')).toBeInTheDocument();
  });

  it('shows first-time setup instead of the private shell when no owner exists', async () => {
    mockBootstrap({
      authenticated: false,
      owner: null,
      sessionExpiresAt: null,
      setupRequired: true,
    });
    renderApp();

    expect(
      await screen.findByRole('heading', {
        name: 'Create your private owner account.',
      }),
    ).toBeInTheDocument();
    expect(
      Array.from(
        screen
          .getByRole('img', { name: 'BizzieMoney' })
          .querySelectorAll('img'),
        (image) => image.getAttribute('src'),
      ),
    ).toEqual([
      '/brand/bizziemoney-auth-light-display.png',
      '/brand/bizziemoney-auth-dark-display.png',
    ]);
    expect(
      screen.queryByRole('navigation', { name: 'Main navigation' }),
    ).not.toBeInTheDocument();
  });

  it('shows owner login after setup when there is no active session', async () => {
    mockBootstrap({
      authenticated: false,
      owner: null,
      sessionExpiresAt: null,
      setupRequired: false,
    });
    renderApp();

    expect(
      await screen.findByRole('heading', {
        name: 'Your money is ready when you are.',
      }),
    ).toBeInTheDocument();
    expect(
      Array.from(
        screen
          .getByRole('img', { name: 'BizzieMoney' })
          .querySelectorAll('img'),
        (image) => image.getAttribute('src'),
      ),
    ).toEqual([
      '/brand/bizziemoney-auth-light-display.png',
      '/brand/bizziemoney-auth-dark-display.png',
    ]);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
