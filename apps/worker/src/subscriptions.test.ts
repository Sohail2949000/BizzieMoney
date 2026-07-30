import { describe, expect, it, vi } from 'vitest';

import {
  SubscriptionMaintenanceProcessor,
  type SubscriptionMaintenanceStore,
} from './subscriptions';

describe('subscription maintenance processor', () => {
  it('delegates one idempotent maintenance pass', async () => {
    const runMaintenance = vi.fn(() =>
      Promise.resolve({
        endedSubscriptions: 1,
        readyReminders: 2,
        staleReminders: 3,
      }),
    );
    const processor = new SubscriptionMaintenanceProcessor({
      runMaintenance,
    } satisfies SubscriptionMaintenanceStore);

    await expect(processor.run()).resolves.toEqual({
      endedSubscriptions: 1,
      readyReminders: 2,
      staleReminders: 3,
    });
    expect(runMaintenance).toHaveBeenCalledOnce();
  });
});
