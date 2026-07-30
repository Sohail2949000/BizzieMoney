// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackupSettings } from './BackupSettings';

vi.mock('../preferences/context', () => ({
  usePreferences: () => ({
    formatDateTime: (value: string | null) => value ?? 'Not scheduled',
    preferences: {
      firstDayOfWeek: 0,
      timeZone: 'Asia/Riyadh',
    },
  }),
}));

const config = {
  backupTime: '02:00',
  dayOfMonth: null,
  dayOfWeek: null,
  destination: 's3',
  enabled: true,
  frequency: 'daily',
  hasEncryptionPassword: false,
  includeAttachments: true,
  localSubfolder: 'automatic',
  nextRunAt: '2026-07-30T23:00:00.000Z',
  retentionCount: 7,
  s3: {
    bucket: 'bizziemoney',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    forcePathStyle: false,
    hasCredentials: true,
    prefix: 'bizziemoney/backups',
    region: 'auto',
  },
  updatedAt: '2026-07-29T00:00:00.000Z',
};

function renderBackupSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BackupSettings />
    </QueryClientProvider>,
  );
}

describe('BackupSettings', () => {
  it('masks and locks saved S3 credentials until editing is requested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input;
        const payload = url.includes('/api/backups/status')
          ? {
              activeJob: null,
              config,
              configured: true,
              lastSuccessfulBackup: null,
              worker: {
                lastSeenAt: '2026-07-29T00:00:00.000Z',
                status: 'online',
              },
            }
          : url.includes('/api/backups/history')
            ? { artifacts: [], jobs: [] }
            : { config };
        return Promise.resolve({
          json: () => Promise.resolve(payload),
          ok: true,
          status: 200,
        } as Response);
      }),
    );
    renderBackupSettings();

    const summary = screen
      .getByRole('heading', { name: 'Automatic backups' })
      .closest('summary');
    fireEvent.click(summary!);

    const accessKey = await screen.findByLabelText(/Access key ID/);
    const secretKey = screen.getByLabelText(/Secret access key/);
    expect(accessKey).toHaveValue('**********************');
    expect(accessKey).toHaveAttribute('readonly');
    expect(secretKey).toHaveValue('**********************');
    expect(secretKey).toHaveAttribute('readonly');
    expect(
      screen.getByLabelText(/S3 \/ Cloudflare R2/).closest('label'),
    ).toHaveClass('is-selected');

    fireEvent.click(screen.getByRole('button', { name: 'Edit configuration' }));

    expect(screen.getByLabelText(/Access key ID/)).toHaveValue('');
    expect(screen.getByLabelText(/Secret access key/)).toHaveValue('');
    expect(screen.getByLabelText(/Secret access key/)).not.toHaveAttribute(
      'readonly',
    );
  });
});
