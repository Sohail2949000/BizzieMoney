import { describe, expect, it } from 'vitest';

import {
  buildDemoSeedPlan,
  DEMO_CATEGORY_NAMES,
  DEMO_CURRENCIES,
  DEMO_MONTH_COUNTS,
  DEMO_PAYMENT_METHOD_NAMES,
} from './demo-data';

const categoryIds = Object.fromEntries(
  DEMO_CATEGORY_NAMES.map((name, index) => [
    name,
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
);
const paymentMethodIds = Object.fromEntries(
  DEMO_PAYMENT_METHOD_NAMES.map((name, index) => [
    name,
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
);

describe('demo data plan', () => {
  it('builds deterministic mixed-currency records for every month', () => {
    const input = {
      categoryIds,
      ownerId: '20000000-0000-4000-8000-000000000001',
      paymentMethodIds,
      year: 2026,
    };
    const first = buildDemoSeedPlan(input);
    const second = buildDemoSeedPlan(input);
    const expectedCount = DEMO_MONTH_COUNTS.reduce(
      (total, count) => total + count,
      0,
    );

    expect(first).toEqual(second);
    expect(first.expenses).toHaveLength(expectedCount);
    expect(first.subscriptions).toHaveLength(expectedCount);
    expect(first.debts).toHaveLength(expectedCount);
    expect(new Set(first.expenses.map((row) => row.currency_code))).toEqual(
      new Set(DEMO_CURRENCIES),
    );
    expect(new Set(first.debts.map((row) => row.direction))).toEqual(
      new Set(['i_owe', 'owed_to_me']),
    );

    for (let month = 1; month <= 12; month += 1) {
      const prefix = `2026-${String(month).padStart(2, '0')}-`;
      const expectedMonthCount = DEMO_MONTH_COUNTS[month - 1] ?? 0;
      expect(
        first.expenses.filter((row) =>
          String(row.expense_date).startsWith(prefix),
        ),
      ).toHaveLength(expectedMonthCount);
      expect(
        first.subscriptions.filter((row) =>
          String(row.next_payment_date).startsWith(prefix),
        ),
      ).toHaveLength(expectedMonthCount);
      expect(
        first.debts.filter((row) => String(row.start_date).startsWith(prefix)),
      ).toHaveLength(expectedMonthCount);
    }
  });
});
