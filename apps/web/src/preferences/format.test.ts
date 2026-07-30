import { describe, expect, it } from 'vitest';

import type { OwnerPreferences } from '@bizziemoney/shared';

import { createPreferenceFormatters, formatDateOnly } from './format';

const preferences: OwnerPreferences = {
  dateFormat: 'dd/MM/yyyy',
  defaultCurrency: 'EUR',
  firstDayOfWeek: 1,
  numberFormat: '1.234,56',
  timeZone: 'Asia/Riyadh',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

describe('preference formatting', () => {
  it('formats date-only values without shifting the calendar date', () => {
    expect(formatDateOnly('2026-07-28', 'MMM d, yyyy')).toBe('Jul 28, 2026');
    expect(formatDateOnly('2026-07-28', 'dd/MM/yyyy')).toBe('28/07/2026');
    expect(formatDateOnly('2026-07-28', 'MM/dd/yyyy')).toBe('07/28/2026');
    expect(formatDateOnly('2026-07-28', 'yyyy-MM-dd')).toBe('2026-07-28');
  });

  it('uses explicit separators and the owner time zone', () => {
    const formatters = createPreferenceFormatters(preferences);

    expect(
      formatters.formatMoney('1234.56', 'EUR').replaceAll(/\s/g, ''),
    ).toContain('1.234,56');
    expect(formatters.formatDateTime('2026-07-31T22:30:00.000Z')).toContain(
      '01/08/2026',
    );
    expect(formatters.currentMonth(new Date('2026-07-31T22:30:00.000Z'))).toBe(
      '2026-08',
    );
  });
});
