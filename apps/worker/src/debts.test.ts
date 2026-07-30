import { describe, expect, it, vi } from 'vitest';

import { DebtMaintenanceProcessor, type DebtMaintenanceStore } from './debts';

describe('debt maintenance processor', () => {
  it('delegates one idempotent overdue-status pass', async () => {
    const runMaintenance = vi.fn(() =>
      Promise.resolve({ activatedDebts: 1, overdueDebts: 2 }),
    );
    const processor = new DebtMaintenanceProcessor({
      runMaintenance,
    } satisfies DebtMaintenanceStore);

    await expect(processor.run()).resolves.toEqual({
      activatedDebts: 1,
      overdueDebts: 2,
    });
    expect(runMaintenance).toHaveBeenCalledOnce();
  });
});
