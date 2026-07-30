// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StorageSettings } from './StorageSettings';

const status = {
  allowedMimeTypes: ['application/pdf', 'image/png'],
  availableProviders: ['local', 's3'],
  configuration: {
    provider: 'local',
    s3: null,
    source: 'environment',
    updatedAt: null,
  },
  fileCount: 4,
  malwareScanner: 'not-configured',
  maxUploadSizeBytes: 20 * 1_048_576,
  provider: 'local',
  providerLabel: 'Local host folder',
  totalSizeBytes: 12_700_000,
};

function renderStorageSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StorageSettings />
    </QueryClientProvider>,
  );
}

function openStorageSettings(): void {
  const details = screen.getByText('File storage').closest('details');
  if (!details) throw new Error('Storage disclosure was not rendered.');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('StorageSettings', () => {
  it('validates and saves an S3/R2 configuration without rendering secrets', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const method = init?.method ?? 'GET';
      return Promise.resolve({
        json: () =>
          Promise.resolve(
            method === 'PATCH'
              ? {
                  configuration: {
                    provider: 's3',
                    s3: {
                      bucket: 'private-receipts',
                      endpoint: 'https://account.r2.cloudflarestorage.com',
                      forcePathStyle: false,
                      hasCredentials: true,
                      prefix: 'bizziemoney',
                      region: 'auto',
                    },
                    source: 'settings',
                    updatedAt: '2026-07-29T00:00:00.000Z',
                  },
                }
              : status,
          ),
        ok: true,
        status: 200,
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderStorageSettings();
    openStorageSettings();

    expect(
      await screen.findByText('Server environment defaults'),
    ).toBeVisible();
    fireEvent.click(screen.getByLabelText(/S3 \/ Cloudflare R2/));
    fireEvent.change(screen.getByLabelText('Bucket'), {
      target: { value: 'private-receipts' },
    });
    fireEvent.change(screen.getByLabelText(/Endpoint \(optional for AWS\)/), {
      target: { value: 'https://account.r2.cloudflarestorage.com' },
    });
    fireEvent.change(screen.getByLabelText(/Access key ID/), {
      target: { value: 'r2-access-key' },
    });
    fireEvent.change(screen.getByLabelText(/Secret access key/), {
      target: { value: 'r2-secret-key' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save storage settings' }),
    );

    expect(
      await screen.findByText(/Attachment storage settings saved/),
    ).toBeInTheDocument();
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const patchBody = patchCall?.[1]?.body;
    expect(typeof patchBody).toBe('string');
    expect(JSON.parse(patchBody as string)).toEqual({
      provider: 's3',
      s3: {
        accessKeyId: 'r2-access-key',
        bucket: 'private-receipts',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        forcePathStyle: false,
        prefix: 'bizziemoney',
        region: 'auto',
        secretAccessKey: 'r2-secret-key',
      },
    });
    expect(screen.queryByText('r2-secret-key')).not.toBeInTheDocument();
  });

  it('requires both credential fields and can test the local mount', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve({
        json: () =>
          Promise.resolve(
            init?.method === 'POST'
              ? { message: 'The local attachment folder is ready.' }
              : status,
          ),
        ok: true,
        status: 200,
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderStorageSettings();
    openStorageSettings();

    expect(await screen.findByText('Host-mounted storage')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText('The local attachment folder is ready.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(true),
    );
  });

  it('masks and locks saved S3 credentials until editing is requested', async () => {
    const savedStatus = {
      ...status,
      configuration: {
        provider: 's3' as const,
        s3: {
          bucket: 'private-receipts',
          endpoint: 'https://account.r2.cloudflarestorage.com',
          forcePathStyle: false,
          hasCredentials: true,
          prefix: 'bizziemoney',
          region: 'auto',
        },
        source: 'settings' as const,
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      provider: 's3',
      providerLabel: 'S3 / Cloudflare R2',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve(savedStatus),
          ok: true,
          status: 200,
        } as Response),
      ),
    );
    renderStorageSettings();
    openStorageSettings();

    const accessKey = await screen.findByLabelText(/Access key ID/);
    const secretKey = screen.getByLabelText(/Secret access key/);
    expect(accessKey).toHaveValue('**********************');
    expect(accessKey).toHaveAttribute('readonly');
    expect(secretKey).toHaveValue('**********************');
    expect(secretKey).toHaveAttribute('readonly');
    expect(
      screen.getByRole('button', { name: 'Save storage settings' }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText(/S3 \/ Cloudflare R2/).closest('label'),
    ).toHaveClass('is-selected');

    fireEvent.click(screen.getByRole('button', { name: 'Edit configuration' }));

    expect(screen.getByLabelText(/Access key ID/)).toHaveValue('');
    expect(screen.getByLabelText(/Access key ID/)).not.toHaveAttribute(
      'readonly',
    );
    expect(screen.getByLabelText(/Secret access key/)).toHaveValue('');
  });
});
