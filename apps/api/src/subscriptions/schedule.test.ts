import { describe, expect, it } from 'vitest';

import { isCalendarDate, nextBillingDate, reminderDate } from './schedule';

describe('subscription calendar schedules', () => {
  it('clamps month-end billing dates without time-zone conversion', () => {
    expect(nextBillingDate('2026-01-31', 'monthly', null)).toBe('2026-02-28');
    expect(nextBillingDate('2028-01-31', 'monthly', null)).toBe('2028-02-29');
  });

  it('supports fixed and custom intervals', () => {
    expect(nextBillingDate('2026-07-27', 'weekly', null)).toBe('2026-08-03');
    expect(nextBillingDate('2026-07-27', 'quarterly', null)).toBe('2026-10-27');
    expect(nextBillingDate('2026-07-27', 'custom', 10)).toBe('2026-08-06');
  });

  it('calculates reminder dates and rejects impossible dates', () => {
    expect(reminderDate('2026-08-05', 3)).toBe('2026-08-02');
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });
});
