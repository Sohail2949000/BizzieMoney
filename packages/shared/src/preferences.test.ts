import { describe, expect, it } from 'vitest';

import {
  currentDateInTimeZone,
  currentMonthInTimeZone,
  isSupportedCurrency,
  isSupportedTimeZone,
} from './preferences';

describe('regional preference helpers', () => {
  it('calculates owner-local dates and months at UTC boundaries', () => {
    const instant = new Date('2026-07-31T22:30:00.000Z');

    expect(currentDateInTimeZone(instant, 'UTC')).toBe('2026-07-31');
    expect(currentDateInTimeZone(instant, 'Asia/Riyadh')).toBe('2026-08-01');
    expect(currentMonthInTimeZone(instant, 'UTC')).toBe('2026-07');
    expect(currentMonthInTimeZone(instant, 'Asia/Riyadh')).toBe('2026-08');
  });

  it('only accepts supported currencies and IANA time zones', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('usd')).toBe(false);
    expect(isSupportedCurrency('ZZZ')).toBe(false);
    expect(isSupportedTimeZone('Asia/Riyadh')).toBe(true);
    expect(isSupportedTimeZone('UTC')).toBe(true);
    expect(isSupportedTimeZone('Mars/Olympus')).toBe(false);
  });
});
