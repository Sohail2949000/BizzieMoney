import { describe, expect, it, vi } from 'vitest';

import {
  SessionMaintenanceProcessor,
  type SessionMaintenanceStore,
} from './sessions';

describe('session maintenance processor', () => {
  it('prunes sessions and rate limits only after the retention window', async () => {
    const prune = vi.fn<SessionMaintenanceStore['prune']>().mockResolvedValue({
      rateLimitsPruned: 3,
      sessionsPruned: 2,
    });
    const now = new Date('2026-07-29T12:00:00.000Z');
    const processor = new SessionMaintenanceProcessor({ prune }, 30, () => now);

    await expect(processor.run()).resolves.toEqual({
      rateLimitsPruned: 3,
      sessionsPruned: 2,
    });
    expect(prune).toHaveBeenCalledWith(new Date('2026-06-29T12:00:00.000Z'));
  });
});
