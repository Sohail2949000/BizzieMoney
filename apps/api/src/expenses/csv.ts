import { isSupportedCurrency } from '@bizziemoney/shared';

import type {
  ExpenseImportError,
  ExpenseImportPreview,
  ExpenseImportRow,
  ExpenseOptions,
} from './types.js';

const MAX_IMPORT_ROWS = 1_000;
const MAX_IMPORT_CHARACTERS = 2_000_000;
const amountPattern = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/;

const supportedHeaders = new Set([
  'amount',
  'attachments',
  'category',
  'created at',
  'currency',
  'date',
  'description',
  'merchant',
  'notes',
  'payment method',
  'tags',
  'updated at',
]);
const requiredHeaders = ['amount', 'date', 'description'] as const;

export class ExpenseCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseCsvError';
  }
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ');
}

function normalizeOptionName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function normalizeImportTags(tags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawTag of tags) {
    const name = rawTag.trim();
    if (!name) continue;
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (!unique.has(normalizedName)) unique.set(normalizedName, name);
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
}

function restoreFormulaProtectedText(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function parseCsv(csvText: string): string[][] {
  if (csvText.length > MAX_IMPORT_CHARACTERS) {
    throw new ExpenseCsvError('Choose a CSV file no larger than 2 MB.');
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index]!;
    if (quoted) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new ExpenseCsvError('The CSV contains an unclosed quoted field.');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }

  return rows.filter((candidate) =>
    candidate.some((value) => value.trim().length > 0),
  );
}

function error(
  field: ExpenseImportError['field'],
  message: string,
): ExpenseImportError {
  return { field, message };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function textValue(
  values: Map<string, string>,
  name: string,
  maximum: number,
  errors: ExpenseImportError[],
): string {
  const value = restoreFormulaProtectedText(values.get(name)?.trim() ?? '');
  if (value.length > maximum) {
    errors.push(error(name, `${name} must be ${maximum} characters or fewer.`));
  }
  return value;
}

function findOption(
  name: string,
  options: Array<{ id: string; name: string }>,
): { id: string; name: string } | undefined {
  const wanted = normalizeOptionName(name || 'Other');
  return options.find((option) => normalizeOptionName(option.name) === wanted);
}

export function previewExpenseCsv(
  csvText: string,
  context: {
    defaultCurrency: string;
    options: ExpenseOptions;
  },
): ExpenseImportPreview {
  const csvRows = parseCsv(csvText);
  if (csvRows.length === 0) {
    throw new ExpenseCsvError('The CSV file is empty.');
  }

  const headers = csvRows[0]!.map(normalizeHeader);
  const duplicate = headers.find(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicate) {
    throw new ExpenseCsvError(
      `The CSV has more than one “${duplicate}” column.`,
    );
  }
  const unknown = headers.find((header) => !supportedHeaders.has(header));
  if (unknown) {
    throw new ExpenseCsvError(`The CSV column “${unknown}” is not supported.`);
  }
  const missing = requiredHeaders.find((header) => !headers.includes(header));
  if (missing) {
    throw new ExpenseCsvError(
      `The CSV is missing the required “${missing}” column.`,
    );
  }

  const sourceRows = csvRows.slice(1);
  if (sourceRows.length === 0) {
    throw new ExpenseCsvError('The CSV does not contain any expense rows.');
  }
  if (sourceRows.length > MAX_IMPORT_ROWS) {
    throw new ExpenseCsvError(
      `Import no more than ${MAX_IMPORT_ROWS.toLocaleString('en-US')} expenses at once.`,
    );
  }

  const rows = sourceRows.map((source, rowIndex) => {
    const values = new Map(
      headers.map((header, index) => [header, source[index] ?? '']),
    );
    const errors: ExpenseImportError[] = [];
    if (source.length > headers.length) {
      errors.push(error('row', 'This row has more values than the header.'));
    }

    const date = values.get('date')?.trim() ?? '';
    if (!isCalendarDate(date)) {
      errors.push(error('date', 'Use a real date in YYYY-MM-DD format.'));
    }

    const amount = values.get('amount')?.trim() ?? '';
    if (!amountPattern.test(amount) || !/[1-9]/.test(amount)) {
      errors.push(
        error(
          'amount',
          'Use a positive amount with up to 15 digits and 4 decimal places.',
        ),
      );
    }

    const description = textValue(values, 'description', 160, errors);
    if (!description) {
      errors.push(error('description', 'Description is required.'));
    }
    const merchant = textValue(values, 'merchant', 120, errors);
    const notes = textValue(values, 'notes', 5_000, errors);

    const currencyCode = (
      values.get('currency')?.trim() || context.defaultCurrency
    ).toUpperCase();
    if (!isSupportedCurrency(currencyCode)) {
      errors.push(error('currency', 'Choose a supported ISO currency code.'));
    }

    const categoryText = restoreFormulaProtectedText(
      values.get('category')?.trim() ?? '',
    );
    const category = findOption(categoryText, context.options.categories);
    if (!category) {
      errors.push(
        error(
          'category',
          categoryText
            ? `No active category named “${categoryText}” was found.`
            : 'The fallback “Other” category is not available.',
        ),
      );
    }

    const paymentText = restoreFormulaProtectedText(
      values.get('payment method')?.trim() ?? '',
    );
    const paymentMethod = findOption(
      paymentText,
      context.options.paymentMethods,
    );
    if (!paymentMethod) {
      errors.push(
        error(
          'payment method',
          paymentText
            ? `No active payment method named “${paymentText}” was found.`
            : 'The fallback “Other” payment method is not available.',
        ),
      );
    }

    const tags = normalizeImportTags(
      (values.get('tags') ?? '')
        .split(';')
        .map((tag) => restoreFormulaProtectedText(tag).trim()),
    );
    if (tags.length > 10) {
      errors.push(error('tags', 'Use no more than 10 tags.'));
    }
    if (tags.some((tag) => tag.length > 40)) {
      errors.push(error('tags', 'Each tag must be 40 characters or fewer.'));
    }

    return {
      amount,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? (categoryText || 'Other'),
      currencyCode,
      date,
      description,
      errors,
      merchant: merchant || null,
      notes: notes || null,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodName: paymentMethod?.name ?? (paymentText || 'Other'),
      rowNumber: rowIndex + 2,
      tags,
      valid: errors.length === 0,
    };
  });

  return {
    errorCount: rows.filter((row) => !row.valid).length,
    rows,
    totalRows: rows.length,
    validCount: rows.filter((row) => row.valid).length,
  };
}

export function validImportRows(
  preview: ExpenseImportPreview,
): ExpenseImportRow[] {
  return preview.rows
    .filter(
      (
        row,
      ): row is typeof row & {
        categoryId: string;
        paymentMethodId: string;
      } => row.valid && Boolean(row.categoryId) && Boolean(row.paymentMethodId),
    )
    .map((row) => ({
      amount: row.amount,
      categoryId: row.categoryId,
      currencyCode: row.currencyCode,
      date: row.date,
      description: row.description,
      merchant: row.merchant,
      notes: row.notes,
      paymentMethodId: row.paymentMethodId,
      rowNumber: row.rowNumber,
      tags: row.tags,
    }));
}

export { MAX_IMPORT_CHARACTERS, MAX_IMPORT_ROWS };
