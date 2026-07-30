import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { AppError } from '../errors.js';
import { ExpenseCsvError, previewExpenseCsv, validImportRows } from './csv.js';
import { cursorValue } from './store.js';
import type { ExpenseStore, PostgresExpenseStore } from './store.js';
import type {
  CategoryDeletionPreview,
  CategoryDeletionResult,
  ExpenseFilters,
  ExpenseImportPreview,
  ExpenseImportResult,
  ExpenseListResponse,
  ExpenseOptions,
  ExpenseRecord,
  ExpenseServiceContract,
  ExpenseSort,
  ExpenseSummary,
  ExpenseWriteInput,
  MoneyOption,
  PublicExpense,
} from './types.js';

const cursorSchema = z.object({
  id: z.uuid(),
  sort: z.enum([
    'date_desc',
    'date_asc',
    'amount_desc',
    'amount_asc',
    'updated_desc',
  ]),
  value: z.string().min(1).max(64),
  version: z.literal(1),
});

function toPublicExpense(expense: ExpenseRecord): PublicExpense {
  return {
    ...expense,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

function encodeCursor(expense: ExpenseRecord, filters: ExpenseFilters): string {
  return Buffer.from(
    JSON.stringify({
      id: expense.id,
      sort: filters.sort,
      value: cursorValue(expense, filters),
      version: 1,
    }),
  ).toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
  sort: ExpenseSort,
): { id: string; value: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.sort !== sort) throw new Error('sort mismatch');
    return { id: parsed.id, value: parsed.value };
  } catch {
    throw new AppError({
      code: 'CURSOR_INVALID',
      message: 'That expense page link is no longer valid.',
      statusCode: 400,
    });
  }
}

function normalizeTags(tags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawTag of tags) {
    const name = rawTag.trim();
    if (!name) continue;
    const normalizedName = name.toLocaleLowerCase('en-US');
    if (!unique.has(normalizedName)) {
      unique.set(normalizedName, name);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
}

function normalizeWriteInput(input: ExpenseWriteInput): ExpenseWriteInput {
  return {
    amount: input.amount,
    categoryId: input.categoryId,
    date: input.date,
    description: input.description.trim(),
    merchant: input.merchant?.trim() || null,
    notes: input.notes?.trim() || null,
    paymentMethodId: input.paymentMethodId,
    tags: normalizeTags(input.tags),
  };
}

function requestHash(input: ExpenseWriteInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function csvCell(value: string, protectFormula = true): string {
  const stringValue = String(value);
  const safeValue =
    protectFormula && /^[=+\-@]/.test(stringValue)
      ? `'${stringValue}`
      : stringValue;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function expenseCsvLine(expense: ExpenseRecord): string {
  return [
    csvCell(expense.date, false),
    csvCell(expense.description),
    csvCell(expense.amount, false),
    csvCell(expense.currencyCode, false),
    csvCell(expense.category.name),
    csvCell(expense.paymentMethod.name),
    csvCell(expense.merchant ?? ''),
    csvCell(expense.notes ?? ''),
    csvCell(expense.tags.join('; ')),
    csvCell(String(expense.attachmentCount), false),
    csvCell(expense.createdAt.toISOString(), false),
    csvCell(expense.updatedAt.toISOString(), false),
  ].join(',');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

export class ExpenseService implements ExpenseServiceContract {
  constructor(
    private readonly store: ExpenseStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromPostgres(store: PostgresExpenseStore): ExpenseService {
    return new ExpenseService(store);
  }

  async getOptions(
    ownerId: string,
    includeArchived: boolean,
  ): Promise<ExpenseOptions> {
    return this.store.getOptions(ownerId, includeArchived);
  }

  async createCategory(
    ownerId: string,
    input: { color: string; icon: string; name: string },
  ): Promise<MoneyOption> {
    const option = await this.store.createCategory(ownerId, {
      ...input,
      name: input.name.trim(),
    });
    if (!option) {
      throw new AppError({
        code: 'CATEGORY_EXISTS',
        message: 'A category with that name already exists.',
        statusCode: 409,
      });
    }
    return option;
  }

  async getCategoryDeletionPreview(
    ownerId: string,
    categoryId: string,
  ): Promise<CategoryDeletionPreview> {
    const preview = await this.store.getCategoryDeletionPreview(
      ownerId,
      categoryId,
    );
    if (!preview) throw this.optionNotFound('category');
    return preview;
  }

  async deleteCategory(
    ownerId: string,
    sessionId: string,
    categoryId: string,
    replacementCategoryId: string,
  ): Promise<CategoryDeletionResult> {
    if (categoryId === replacementCategoryId) {
      throw new AppError({
        code: 'CATEGORY_REPLACEMENT_INVALID',
        message: 'Choose a different active category as the replacement.',
        statusCode: 400,
      });
    }
    const result = await this.store.deleteCategory({
      categoryId,
      now: this.now(),
      ownerId,
      replacementCategoryId,
      sessionId,
    });
    if (result.status === 'source_not_found') {
      throw this.optionNotFound('category');
    }
    if (result.status === 'replacement_invalid') {
      throw new AppError({
        code: 'CATEGORY_REPLACEMENT_INVALID',
        message: 'Choose a different active category as the replacement.',
        statusCode: 409,
      });
    }
    return {
      deletedCategoryId: result.deletedCategoryId,
      expenseCount: result.expenseCount,
      replacement: result.replacement,
      subscriptionCount: result.subscriptionCount,
    };
  }

  async updateCategory(
    ownerId: string,
    categoryId: string,
    input: Partial<{
      archived: boolean | undefined;
      color: string | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption> {
    if (input.archived) {
      const options = await this.store.getOptions(ownerId, false);
      if (
        options.categories.length <= 1 &&
        options.categories.some((item) => item.id === categoryId)
      ) {
        throw new AppError({
          code: 'LAST_CATEGORY_ACTIVE',
          message: 'Keep at least one active category.',
          statusCode: 409,
        });
      }
    }
    try {
      const option = await this.store.updateCategory(ownerId, categoryId, {
        ...input,
        name: input.name?.trim(),
      });
      if (!option) throw this.optionNotFound('category');
      return option;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: 'CATEGORY_EXISTS',
          message: 'A category with that name already exists.',
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  async createPaymentMethod(
    ownerId: string,
    input: { icon: string; name: string },
  ): Promise<MoneyOption> {
    const option = await this.store.createPaymentMethod(ownerId, {
      ...input,
      name: input.name.trim(),
    });
    if (!option) {
      throw new AppError({
        code: 'PAYMENT_METHOD_EXISTS',
        message: 'A payment method with that name already exists.',
        statusCode: 409,
      });
    }
    return option;
  }

  async updatePaymentMethod(
    ownerId: string,
    paymentMethodId: string,
    input: Partial<{
      archived: boolean | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption> {
    if (input.archived) {
      const options = await this.store.getOptions(ownerId, false);
      if (
        options.paymentMethods.length <= 1 &&
        options.paymentMethods.some((item) => item.id === paymentMethodId)
      ) {
        throw new AppError({
          code: 'LAST_PAYMENT_METHOD_ACTIVE',
          message: 'Keep at least one active payment method.',
          statusCode: 409,
        });
      }
    }
    try {
      const option = await this.store.updatePaymentMethod(
        ownerId,
        paymentMethodId,
        { ...input, name: input.name?.trim() },
      );
      if (!option) throw this.optionNotFound('payment method');
      return option;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: 'PAYMENT_METHOD_EXISTS',
          message: 'A payment method with that name already exists.',
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  async listExpenses(
    ownerId: string,
    input: {
      categoryId?: string | undefined;
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      hasAttachments?: boolean | undefined;
      limit: number;
      search?: string | undefined;
      sort: ExpenseSort;
    },
  ): Promise<ExpenseListResponse> {
    const filters: ExpenseFilters = {
      categoryId: input.categoryId,
      cursor: decodeCursor(input.cursor, input.sort),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      hasAttachments: input.hasAttachments,
      limit: input.limit,
      search: input.search?.trim() || undefined,
      sort: input.sort,
    };
    const page = await this.store.listExpenses(ownerId, filters);
    const last = page.items.at(-1);
    return {
      items: page.items.map(toPublicExpense),
      nextCursor: page.hasMore && last ? encodeCursor(last, filters) : null,
    };
  }

  async getExpense(ownerId: string, expenseId: string): Promise<PublicExpense> {
    const expense = await this.store.getExpense(ownerId, expenseId);
    if (!expense) throw this.expenseNotFound();
    return toPublicExpense(expense);
  }

  async createExpense(
    ownerId: string,
    sessionId: string,
    idempotencyKey: string,
    rawInput: ExpenseWriteInput,
  ): Promise<{ expense: PublicExpense; replayed: boolean }> {
    const input = normalizeWriteInput(rawInput);
    let result;
    try {
      result = await this.store.createExpense({
        ...input,
        expenseId: randomUUID(),
        idempotencyKey,
        now: this.now(),
        ownerId,
        requestHash: requestHash(input),
        sessionId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'EXPENSE_OPTION_INVALID'
      ) {
        throw this.optionNotFound('category or payment method');
      }
      throw error;
    }
    if (result.mismatched) {
      throw new AppError({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Please retry with a fresh expense request.',
        statusCode: 409,
      });
    }
    const expense = await this.store.getExpense(ownerId, result.expenseId);
    if (!expense) {
      throw new AppError({
        code: 'IDEMPOTENCY_REPLAY_UNAVAILABLE',
        message: 'That expense request has already been completed.',
        statusCode: 409,
      });
    }
    return { expense: toPublicExpense(expense), replayed: result.replayed };
  }

  async previewImport(
    ownerId: string,
    csvText: string,
  ): Promise<ExpenseImportPreview> {
    const context = await this.store.getImportContext(ownerId);
    try {
      return previewExpenseCsv(csvText, context);
    } catch (error) {
      if (error instanceof ExpenseCsvError) {
        throw new AppError({
          code: 'EXPENSE_IMPORT_CSV_INVALID',
          message: error.message,
          statusCode: 400,
        });
      }
      throw error;
    }
  }

  async importExpenses(
    ownerId: string,
    sessionId: string,
    idempotencyKey: string,
    csvText: string,
  ): Promise<ExpenseImportResult> {
    const preview = await this.previewImport(ownerId, csvText);
    if (preview.errorCount > 0) {
      throw new AppError({
        code: 'EXPENSE_IMPORT_INVALID',
        message:
          'Fix every row marked in the preview before importing this file.',
        statusCode: 400,
      });
    }
    const rows = validImportRows(preview);
    const hash = createHash('sha256').update(csvText).digest('hex');
    let result;
    try {
      result = await this.store.importExpenses({
        idempotencyKey,
        now: this.now(),
        ownerId,
        requestHash: hash,
        rows,
        sessionId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'EXPENSE_OPTION_INVALID'
      ) {
        throw new AppError({
          code: 'EXPENSE_IMPORT_OPTIONS_CHANGED',
          message:
            'A category or payment method changed after preview. Preview the file again.',
          statusCode: 409,
        });
      }
      throw error;
    }
    if (result.mismatched) {
      throw new AppError({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Please retry the import with a fresh request.',
        statusCode: 409,
      });
    }
    return {
      currencyCounts: result.currencyCounts,
      importedCount: result.importedCount,
      replayed: result.replayed,
    };
  }

  async updateExpense(
    ownerId: string,
    sessionId: string,
    expenseId: string,
    rawInput: ExpenseWriteInput,
  ): Promise<PublicExpense> {
    const input = normalizeWriteInput(rawInput);
    let updated: boolean;
    try {
      updated = await this.store.updateExpense({
        ...input,
        expenseId,
        now: this.now(),
        ownerId,
        sessionId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'EXPENSE_OPTION_INVALID'
      ) {
        throw this.optionNotFound('category or payment method');
      }
      throw error;
    }
    if (!updated) throw this.expenseNotFound();
    return this.getExpense(ownerId, expenseId);
  }

  async deleteExpense(
    ownerId: string,
    sessionId: string,
    expenseId: string,
  ): Promise<void> {
    const deleted = await this.store.deleteExpense({
      expenseId,
      now: this.now(),
      ownerId,
      sessionId,
    });
    if (!deleted) throw this.expenseNotFound();
  }

  async getSummary(ownerId: string, month: string): Promise<ExpenseSummary> {
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(year, monthNumber, 1))
      .toISOString()
      .slice(0, 10);
    const [summary, recent] = await Promise.all([
      this.store.getSummary({ monthEnd, monthStart, ownerId }),
      this.store.listExpenses(ownerId, {
        limit: 5,
        sort: 'date_desc',
      }),
    ]);
    return {
      ...summary,
      month,
      recent: recent.items.map(toPublicExpense),
    };
  }

  async *exportExpenses(
    ownerId: string,
    filters: Omit<ExpenseFilters, 'cursor' | 'limit'>,
  ): AsyncGenerator<string> {
    yield `\uFEFF${[
      'Date',
      'Description',
      'Amount',
      'Currency',
      'Category',
      'Payment method',
      'Merchant',
      'Notes',
      'Tags',
      'Attachments',
      'Created at',
      'Updated at',
    ].join(',')}\r\n`;

    let cursor: ExpenseFilters['cursor'];
    do {
      const pageFilters: ExpenseFilters = {
        ...filters,
        cursor,
        limit: 500,
      };
      const page = await this.store.listExpenses(ownerId, pageFilters);
      for (const expense of page.items) {
        yield `${expenseCsvLine(expense)}\r\n`;
      }
      const last = page.items.at(-1);
      cursor =
        page.hasMore && last
          ? { id: last.id, value: cursorValue(last, pageFilters) }
          : undefined;
      if (!page.hasMore || !last) return;
    } while (cursor);
  }

  private expenseNotFound(): AppError {
    return new AppError({
      code: 'EXPENSE_NOT_FOUND',
      message: 'That expense could not be found.',
      statusCode: 404,
    });
  }

  private optionNotFound(option: string): AppError {
    return new AppError({
      code: 'EXPENSE_OPTION_NOT_FOUND',
      message: `Choose an active ${option}.`,
      statusCode: 400,
    });
  }
}

export { decodeCursor, encodeCursor, normalizeTags, toPublicExpense };
