import { describe, expect, it } from 'vitest';

import {
  APP_NAME,
  APP_SCHEMA_VERSION,
  APP_VERSION,
  navigationItems,
} from './index';

describe('shared product constants', () => {
  it('keeps the product name and navigation intentionally small', () => {
    expect(APP_NAME).toBe('BizzieMoney');
    expect(APP_VERSION).toBe('1.0.0');
    expect(APP_SCHEMA_VERSION).toBe(16);
    expect(navigationItems.map(({ label }) => label)).toEqual([
      'Overview',
      'Expenses',
      'Subscriptions',
      'Loans & Debts',
      'Settings',
    ]);
  });
});
