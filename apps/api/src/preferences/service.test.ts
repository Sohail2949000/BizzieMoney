import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStore } from './store.js';
import { PreferenceService } from './service.js';
import type { PreferenceRecord } from './types.js';

const now = new Date('2026-07-28T10:00:00.000Z');
const record: PreferenceRecord = {
  dateFormat: 'MMM d, yyyy',
  defaultCurrency: 'USD',
  firstDayOfWeek: 0,
  numberFormat: '1,234.56',
  timeZone: 'Asia/Riyadh',
  updatedAt: new Date('2026-07-27T10:00:00.000Z'),
};

function createStore(overrides: Partial<PreferenceStore> = {}) {
  return {
    get: vi.fn(() => Promise.resolve(record)),
    update: vi.fn<PreferenceStore['update']>((input) =>
      Promise.resolve({
        ...record,
        ...input.changes,
        updatedAt: input.now,
      }),
    ),
    ...overrides,
  } satisfies PreferenceStore;
}

describe('PreferenceService', () => {
  it('returns the complete public preference record', async () => {
    const service = new PreferenceService(createStore(), () => now);

    await expect(service.get('owner-id')).resolves.toEqual({
      ...record,
      updatedAt: record.updatedAt.toISOString(),
    });
  });

  it('only persists and audits values that actually changed', async () => {
    const update = vi.fn<PreferenceStore['update']>((input) =>
      Promise.resolve({
        ...record,
        ...input.changes,
        updatedAt: input.now,
      }),
    );
    const service = new PreferenceService(createStore({ update }), () => now);

    await service.update('owner-id', 'session-id', {
      dateFormat: record.dateFormat,
      defaultCurrency: 'EUR',
      timeZone: 'Europe/Paris',
    });

    expect(update).toHaveBeenCalledWith({
      changedFields: ['defaultCurrency', 'timeZone'],
      changes: {
        dateFormat: record.dateFormat,
        defaultCurrency: 'EUR',
        timeZone: 'Europe/Paris',
      },
      now,
      ownerId: 'owner-id',
      sessionId: 'session-id',
    });
  });

  it('does not create an audit event for a no-op update', async () => {
    const store = createStore();
    const service = new PreferenceService(store, () => now);

    await service.update('owner-id', 'session-id', {
      defaultCurrency: 'USD',
    });

    expect(store.update).not.toHaveBeenCalled();
  });
});
