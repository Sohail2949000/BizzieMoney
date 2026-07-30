import type { StorageRegistry } from '@bizziemoney/storage';
import { describe, expect, it, vi } from 'vitest';

import { DataService } from './service';
import type { DataStore } from './types';

function createStore(overrides: Partial<DataStore> = {}): DataStore {
  return {
    purgeFinancialData: vi.fn(() =>
      Promise.resolve({
        attachmentFilesQueued: 0,
        attachments: 0,
        completedAt: '2026-07-29T00:00:00.000Z',
        debtPayments: 0,
        debts: 0,
        expenses: 0,
        replayed: false,
        subscriptionPayments: 0,
        subscriptions: 0,
        tags: 0,
      }),
    ),
    writePortableSnapshot: vi.fn(),
    ...overrides,
  };
}

const unusedStorage = {} as StorageRegistry;

describe('DataService', () => {
  it('requires the exact destructive confirmation before calling the store', async () => {
    const purgeFinancialData = vi.fn<DataStore['purgeFinancialData']>();
    const service = new DataService(
      createStore({ purgeFinancialData }),
      unusedStorage,
    );

    await expect(
      service.purgeFinancialData(
        'session-id',
        'owner-id',
        '00000000-0000-4000-8000-000000000001',
        'delete all data',
      ),
    ).rejects.toMatchObject({
      code: 'PURGE_CONFIRMATION_INVALID',
      statusCode: 400,
    });
    expect(purgeFinancialData).not.toHaveBeenCalled();
  });

  it('passes a non-sensitive stable request hash to the atomic store', async () => {
    const purgeFinancialData = vi.fn<DataStore['purgeFinancialData']>(() =>
      Promise.resolve({
        attachmentFilesQueued: 0,
        attachments: 0,
        completedAt: '2026-07-29T00:00:00.000Z',
        debtPayments: 0,
        debts: 0,
        expenses: 0,
        replayed: false,
        subscriptionPayments: 0,
        subscriptions: 0,
        tags: 0,
      }),
    );
    const service = new DataService(
      createStore({ purgeFinancialData }),
      unusedStorage,
      () => new Date('2026-07-29T00:00:00.000Z'),
    );

    await service.purgeFinancialData(
      'session-id',
      'owner-id',
      '00000000-0000-4000-8000-000000000001',
      'DELETE ALL DATA',
    );

    const storedInput = purgeFinancialData.mock.calls[0]?.[0];
    expect(storedInput).toMatchObject({
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      now: new Date('2026-07-29T00:00:00.000Z'),
      ownerId: 'owner-id',
      sessionId: 'session-id',
    });
    expect(storedInput?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(purgeFinancialData.mock.calls)).not.toContain(
      'password',
    );
  });
});
