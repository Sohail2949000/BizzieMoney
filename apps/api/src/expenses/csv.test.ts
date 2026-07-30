import { describe, expect, it } from 'vitest';

import { ExpenseCsvError, previewExpenseCsv, validImportRows } from './csv';

const context = {
  defaultCurrency: 'USD',
  options: {
    categories: [
      {
        archived: false,
        color: '#16A36A',
        icon: 'utensils',
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Food & Dining',
      },
      {
        archived: false,
        color: '#71717A',
        icon: 'circle-ellipsis',
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Other',
      },
    ],
    paymentMethods: [
      {
        archived: false,
        icon: 'credit-card',
        id: '00000000-0000-4000-8000-000000000003',
        name: 'Bank card',
      },
      {
        archived: false,
        icon: 'circle-ellipsis',
        id: '00000000-0000-4000-8000-000000000004',
        name: 'Other',
      },
    ],
  },
};

describe('expense CSV import', () => {
  it('parses an exported CSV with BOM, quoted content, and formula protection', () => {
    const preview = previewExpenseCsv(
      '\uFEFFDate,Description,Amount,Currency,Category,Payment method,Merchant,Notes,Tags,Attachments,Created at,Updated at\r\n' +
        '2026-07-28,"\'=Lunch, team",18.50,EUR,Food & Dining,Bank card,"Cafe ""One""","Line 1\r\nLine 2","Work; lunch",0,2026-07-28T10:00:00Z,2026-07-28T10:00:00Z\r\n',
      context,
    );

    expect(preview).toMatchObject({
      errorCount: 0,
      totalRows: 1,
      validCount: 1,
    });
    expect(preview.rows[0]).toMatchObject({
      categoryName: 'Food & Dining',
      currencyCode: 'EUR',
      description: '=Lunch, team',
      merchant: 'Cafe "One"',
      notes: 'Line 1\r\nLine 2',
      paymentMethodName: 'Bank card',
      tags: ['lunch', 'Work'],
      valid: true,
    });
  });

  it('uses the saved currency and Other options when optional columns are absent', () => {
    const preview = previewExpenseCsv(
      'Date,Description,Amount\n2026-07-28,Coffee,4.25\n',
      context,
    );

    expect(validImportRows(preview)[0]).toMatchObject({
      categoryId: '00000000-0000-4000-8000-000000000002',
      currencyCode: 'USD',
      paymentMethodId: '00000000-0000-4000-8000-000000000004',
    });
  });

  it('reports every invalid row without accepting a partial import', () => {
    const preview = previewExpenseCsv(
      [
        'Date,Description,Amount,Currency,Category,Payment method,Tags',
        '2026-02-30,,0,ZZZ,Missing,Missing,"one;two;three;four;five;six;seven;eight;nine;ten;eleven"',
        '2026-07-28,Valid row,10,USD,Food & Dining,Bank card,',
      ].join('\n'),
      context,
    );

    expect(preview).toMatchObject({
      errorCount: 1,
      totalRows: 2,
      validCount: 1,
    });
    expect(preview.rows[0]!.errors.map((item) => item.field)).toEqual([
      'date',
      'amount',
      'description',
      'currency',
      'category',
      'payment method',
      'tags',
    ]);
  });

  it('rejects unknown and duplicate headers as structural errors', () => {
    expect(() =>
      previewExpenseCsv(
        'Date,Description,Amount,Mystery\n2026-07-28,Coffee,4.25,x',
        context,
      ),
    ).toThrowError(ExpenseCsvError);
    expect(() =>
      previewExpenseCsv(
        'Date,Description,Amount,Amount\n2026-07-28,Coffee,4.25,4.25',
        context,
      ),
    ).toThrow('more than one “amount”');
  });
});
