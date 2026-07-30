import { randomUUID } from 'node:crypto';

import {
  sql,
  type BizzieMoneyDatabase,
  type Transaction,
  type DatabaseSchema,
} from '@bizziemoney/database';

import { attachmentObjectKeys } from '../attachments/thumbnail-keys';
import type {
  CategoryDeletionPreview,
  CategoryDeletionResult,
  CategorySummary,
  CreateExpenseStoreInput,
  ExpenseCurrencyGroup,
  ExpenseFilters,
  ExpenseOptions,
  ExpensePage,
  ExpenseRecord,
  ImportExpensesStoreInput,
  ImportExpensesStoreResult,
  MoneyOption,
  UpdateExpenseStoreInput,
} from './types';

export type CategoryDeletionStoreResult =
  | ({ status: 'deleted' } & CategoryDeletionResult)
  | { status: 'replacement_invalid' }
  | { status: 'source_not_found' };

interface ExpenseRow {
  amount: string;
  attachment_count: number;
  category_archived: boolean;
  category_color: string;
  category_icon: string;
  category_id: string;
  category_name: string;
  created_at: Date;
  currency_code: string;
  description: string;
  expense_date: Date | string;
  id: string;
  merchant: string | null;
  notes: string | null;
  payment_archived: boolean;
  payment_icon: string;
  payment_method_id: string;
  payment_name: string;
  tags: string[] | null;
  updated_at: Date;
}

interface CreateExpenseResult {
  mismatched: boolean;
  expenseId: string;
  replayed: boolean;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function mapExpense(row: ExpenseRow): ExpenseRecord {
  return {
    amount: row.amount,
    attachmentCount: Number(row.attachment_count),
    category: {
      archived: row.category_archived,
      color: row.category_color,
      icon: row.category_icon,
      id: row.category_id,
      name: row.category_name,
    },
    createdAt: row.created_at,
    currencyCode: row.currency_code.trim(),
    date:
      row.expense_date instanceof Date
        ? row.expense_date.toISOString().slice(0, 10)
        : row.expense_date,
    description: row.description,
    id: row.id,
    merchant: row.merchant,
    notes: row.notes,
    paymentMethod: {
      archived: row.payment_archived,
      icon: row.payment_icon,
      id: row.payment_method_id,
      name: row.payment_name,
    },
    tags: row.tags ?? [],
    updatedAt: row.updated_at,
  };
}

function cursorValue(expense: ExpenseRecord, filters: ExpenseFilters): string {
  switch (filters.sort) {
    case 'amount_asc':
    case 'amount_desc':
      return expense.amount;
    case 'updated_desc':
      return expense.updatedAt.toISOString();
    case 'date_asc':
    case 'date_desc':
      return expense.date;
  }
}

export interface ExpenseStore {
  createCategory(
    ownerId: string,
    input: { color: string; icon: string; name: string },
  ): Promise<MoneyOption | null>;
  createExpense(input: CreateExpenseStoreInput): Promise<CreateExpenseResult>;
  createPaymentMethod(
    ownerId: string,
    input: { icon: string; name: string },
  ): Promise<MoneyOption | null>;
  deleteCategory(input: {
    categoryId: string;
    now: Date;
    ownerId: string;
    replacementCategoryId: string;
    sessionId: string;
  }): Promise<CategoryDeletionStoreResult>;
  deleteExpense(input: {
    expenseId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean>;
  getExpense(ownerId: string, expenseId: string): Promise<ExpenseRecord | null>;
  getImportContext(ownerId: string): Promise<{
    defaultCurrency: string;
    options: ExpenseOptions;
  }>;
  getCategoryDeletionPreview(
    ownerId: string,
    categoryId: string,
  ): Promise<CategoryDeletionPreview | null>;
  getOptions(
    ownerId: string,
    includeArchived: boolean,
  ): Promise<ExpenseOptions>;
  getSummary(input: {
    monthEnd: string;
    monthStart: string;
    ownerId: string;
  }): Promise<{
    count: number;
    currencyGroups: ExpenseCurrencyGroup[];
    defaultCurrency: string;
  }>;
  listExpenses(ownerId: string, filters: ExpenseFilters): Promise<ExpensePage>;
  importExpenses(
    input: ImportExpensesStoreInput,
  ): Promise<ImportExpensesStoreResult>;
  updateCategory(
    ownerId: string,
    categoryId: string,
    input: Partial<{
      archived: boolean | undefined;
      color: string | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption | null>;
  updateExpense(input: UpdateExpenseStoreInput): Promise<boolean>;
  updatePaymentMethod(
    ownerId: string,
    paymentMethodId: string,
    input: Partial<{
      archived: boolean | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption | null>;
}

export class PostgresExpenseStore implements ExpenseStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getOptions(
    ownerId: string,
    includeArchived: boolean,
  ): Promise<ExpenseOptions> {
    let categoryQuery = this.database
      .selectFrom('categories')
      .select(['color', 'icon', 'id', 'is_archived', 'name'])
      .where('owner_id', '=', ownerId);
    let paymentQuery = this.database
      .selectFrom('payment_methods')
      .select(['icon', 'id', 'is_archived', 'name'])
      .where('owner_id', '=', ownerId);

    if (!includeArchived) {
      categoryQuery = categoryQuery.where('is_archived', '=', false);
      paymentQuery = paymentQuery.where('is_archived', '=', false);
    }

    const [categories, paymentMethods] = await Promise.all([
      categoryQuery.orderBy('is_archived').orderBy('normalized_name').execute(),
      paymentQuery.orderBy('is_archived').orderBy('normalized_name').execute(),
    ]);

    return {
      categories: categories.map((item) => ({
        archived: item.is_archived,
        color: item.color.trim(),
        icon: item.icon,
        id: item.id,
        name: item.name,
      })),
      paymentMethods: paymentMethods.map((item) => ({
        archived: item.is_archived,
        icon: item.icon,
        id: item.id,
        name: item.name,
      })),
    };
  }

  async getImportContext(ownerId: string): Promise<{
    defaultCurrency: string;
    options: ExpenseOptions;
  }> {
    const [settings, options] = await Promise.all([
      this.database
        .selectFrom('app_settings')
        .select('default_currency')
        .where('owner_id', '=', ownerId)
        .executeTakeFirstOrThrow(),
      this.getOptions(ownerId, false),
    ]);
    return {
      defaultCurrency: settings.default_currency.trim(),
      options,
    };
  }

  async getCategoryDeletionPreview(
    ownerId: string,
    categoryId: string,
  ): Promise<CategoryDeletionPreview | null> {
    const [category, replacements, expenseCount, subscriptionCount] =
      await Promise.all([
        this.database
          .selectFrom('categories')
          .select(['color', 'icon', 'id', 'is_archived', 'name'])
          .where('owner_id', '=', ownerId)
          .where('id', '=', categoryId)
          .executeTakeFirst(),
        this.database
          .selectFrom('categories')
          .select(['color', 'icon', 'id', 'is_archived', 'name'])
          .where('owner_id', '=', ownerId)
          .where('id', '!=', categoryId)
          .where('is_archived', '=', false)
          .orderBy('normalized_name')
          .execute(),
        this.database
          .selectFrom('expenses')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('owner_id', '=', ownerId)
          .where('category_id', '=', categoryId)
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('subscriptions')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('owner_id', '=', ownerId)
          .where('category_id', '=', categoryId)
          .executeTakeFirstOrThrow(),
      ]);
    if (!category) return null;
    const toOption = (item: typeof category): MoneyOption => ({
      archived: item.is_archived,
      color: item.color.trim(),
      icon: item.icon,
      id: item.id,
      name: item.name,
    });
    return {
      category: toOption(category),
      expenseCount: Number(expenseCount.count),
      replacements: replacements.map(toOption),
      subscriptionCount: Number(subscriptionCount.count),
    };
  }

  async deleteCategory(input: {
    categoryId: string;
    now: Date;
    ownerId: string;
    replacementCategoryId: string;
    sessionId: string;
  }): Promise<CategoryDeletionStoreResult> {
    return this.database.transaction().execute(async (transaction) => {
      const category = await transaction
        .selectFrom('categories')
        .select('id')
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.categoryId)
        .forUpdate()
        .executeTakeFirst();
      if (!category) return { status: 'source_not_found' };

      const replacement = await transaction
        .selectFrom('categories')
        .select(['color', 'icon', 'id', 'is_archived', 'name'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.replacementCategoryId)
        .where('id', '!=', input.categoryId)
        .where('is_archived', '=', false)
        .forUpdate()
        .executeTakeFirst();
      if (!replacement) return { status: 'replacement_invalid' };

      const expenses = await transaction
        .updateTable('expenses')
        .set({
          category_id: replacement.id,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('category_id', '=', input.categoryId)
        .executeTakeFirst();
      const subscriptions = await transaction
        .updateTable('subscriptions')
        .set({
          category_id: replacement.id,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('category_id', '=', input.categoryId)
        .executeTakeFirst();

      await transaction
        .deleteFrom('categories')
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.categoryId)
        .executeTakeFirstOrThrow();
      const expenseCount = Number(expenses.numUpdatedRows);
      const subscriptionCount = Number(subscriptions.numUpdatedRows);
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'category.deleted',
          id: randomUUID(),
          metadata: {
            categoryId: input.categoryId,
            expenseCount,
            replacementCategoryId: replacement.id,
            subscriptionCount,
          },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();

      return {
        deletedCategoryId: input.categoryId,
        expenseCount,
        replacement: {
          archived: replacement.is_archived,
          color: replacement.color.trim(),
          icon: replacement.icon,
          id: replacement.id,
          name: replacement.name,
        },
        status: 'deleted',
        subscriptionCount,
      };
    });
  }

  async createCategory(
    ownerId: string,
    input: { color: string; icon: string; name: string },
  ): Promise<MoneyOption | null> {
    const row = await this.database
      .insertInto('categories')
      .values({
        color: input.color,
        icon: input.icon,
        id: randomUUID(),
        name: input.name,
        normalized_name: normalizeName(input.name),
        owner_id: ownerId,
      })
      .onConflict((conflict) =>
        conflict.columns(['owner_id', 'normalized_name']).doNothing(),
      )
      .returning(['color', 'icon', 'id', 'is_archived', 'name'])
      .executeTakeFirst();

    return row
      ? {
          archived: row.is_archived,
          color: row.color.trim(),
          icon: row.icon,
          id: row.id,
          name: row.name,
        }
      : null;
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
  ): Promise<MoneyOption | null> {
    const update: {
      color?: string;
      icon?: string;
      is_archived?: boolean;
      name?: string;
      normalized_name?: string;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (input.name !== undefined) {
      update.name = input.name;
      update.normalized_name = normalizeName(input.name);
    }
    if (input.icon !== undefined) update.icon = input.icon;
    if (input.color !== undefined) update.color = input.color;
    if (input.archived !== undefined) update.is_archived = input.archived;

    const row = await this.database
      .updateTable('categories')
      .set(update)
      .where('id', '=', categoryId)
      .where('owner_id', '=', ownerId)
      .returning(['color', 'icon', 'id', 'is_archived', 'name'])
      .executeTakeFirst();

    return row
      ? {
          archived: row.is_archived,
          color: row.color.trim(),
          icon: row.icon,
          id: row.id,
          name: row.name,
        }
      : null;
  }

  async createPaymentMethod(
    ownerId: string,
    input: { icon: string; name: string },
  ): Promise<MoneyOption | null> {
    const row = await this.database
      .insertInto('payment_methods')
      .values({
        icon: input.icon,
        id: randomUUID(),
        name: input.name,
        normalized_name: normalizeName(input.name),
        owner_id: ownerId,
      })
      .onConflict((conflict) =>
        conflict.columns(['owner_id', 'normalized_name']).doNothing(),
      )
      .returning(['icon', 'id', 'is_archived', 'name'])
      .executeTakeFirst();

    return row
      ? {
          archived: row.is_archived,
          icon: row.icon,
          id: row.id,
          name: row.name,
        }
      : null;
  }

  async updatePaymentMethod(
    ownerId: string,
    paymentMethodId: string,
    input: Partial<{
      archived: boolean | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption | null> {
    const update: {
      icon?: string;
      is_archived?: boolean;
      name?: string;
      normalized_name?: string;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (input.name !== undefined) {
      update.name = input.name;
      update.normalized_name = normalizeName(input.name);
    }
    if (input.icon !== undefined) update.icon = input.icon;
    if (input.archived !== undefined) update.is_archived = input.archived;

    const row = await this.database
      .updateTable('payment_methods')
      .set(update)
      .where('id', '=', paymentMethodId)
      .where('owner_id', '=', ownerId)
      .returning(['icon', 'id', 'is_archived', 'name'])
      .executeTakeFirst();

    return row
      ? {
          archived: row.is_archived,
          icon: row.icon,
          id: row.id,
          name: row.name,
        }
      : null;
  }

  async listExpenses(
    ownerId: string,
    filters: ExpenseFilters,
  ): Promise<ExpensePage> {
    const conditions = [
      sql<boolean>`e.owner_id = ${ownerId}::uuid`,
      sql<boolean>`e.deleted_at is null`,
    ];
    if (filters.categoryId) {
      conditions.push(
        sql<boolean>`e.category_id = ${filters.categoryId}::uuid`,
      );
    }
    if (filters.dateFrom) {
      conditions.push(
        sql<boolean>`e.expense_date >= ${filters.dateFrom}::date`,
      );
    }
    if (filters.dateTo) {
      conditions.push(sql<boolean>`e.expense_date <= ${filters.dateTo}::date`);
    }
    if (filters.search) {
      conditions.push(
        sql<boolean>`e.search_vector @@ websearch_to_tsquery('simple', ${filters.search})`,
      );
    }
    if (filters.hasAttachments !== undefined) {
      conditions.push(
        filters.hasAttachments
          ? sql<boolean>`exists (
              select 1
              from entity_attachments ea
              inner join attachments a
                on a.owner_id = ea.owner_id
                and a.id = ea.attachment_id
                and a.deleted_at is null
              where ea.owner_id = e.owner_id
                and ea.entity_type = 'expense'
                and ea.entity_id = e.id
            )`
          : sql<boolean>`not exists (
              select 1
              from entity_attachments ea
              inner join attachments a
                on a.owner_id = ea.owner_id
                and a.id = ea.attachment_id
                and a.deleted_at is null
              where ea.owner_id = e.owner_id
                and ea.entity_type = 'expense'
                and ea.entity_id = e.id
            )`,
      );
    }

    if (filters.cursor) {
      const cursor = filters.cursor;
      switch (filters.sort) {
        case 'date_desc':
          conditions.push(sql<boolean>`(
            e.expense_date < ${cursor.value}::date
            or (e.expense_date = ${cursor.value}::date and e.id < ${cursor.id}::uuid)
          )`);
          break;
        case 'date_asc':
          conditions.push(sql<boolean>`(
            e.expense_date > ${cursor.value}::date
            or (e.expense_date = ${cursor.value}::date and e.id > ${cursor.id}::uuid)
          )`);
          break;
        case 'amount_desc':
          conditions.push(sql<boolean>`(
            e.amount < ${cursor.value}::numeric
            or (e.amount = ${cursor.value}::numeric and e.id < ${cursor.id}::uuid)
          )`);
          break;
        case 'amount_asc':
          conditions.push(sql<boolean>`(
            e.amount > ${cursor.value}::numeric
            or (e.amount = ${cursor.value}::numeric and e.id > ${cursor.id}::uuid)
          )`);
          break;
        case 'updated_desc':
          conditions.push(sql<boolean>`(
            e.updated_at < ${cursor.value}::timestamptz
            or (e.updated_at = ${cursor.value}::timestamptz and e.id < ${cursor.id}::uuid)
          )`);
          break;
      }
    }

    let orderBy = sql`e.expense_date desc, e.id desc`;
    switch (filters.sort) {
      case 'date_asc':
        orderBy = sql`e.expense_date asc, e.id asc`;
        break;
      case 'amount_desc':
        orderBy = sql`e.amount desc, e.id desc`;
        break;
      case 'amount_asc':
        orderBy = sql`e.amount asc, e.id asc`;
        break;
      case 'updated_desc':
        orderBy = sql`e.updated_at desc, e.id desc`;
        break;
      case 'date_desc':
        break;
    }

    const result = await sql<ExpenseRow>`
      select
        e.id,
        e.expense_date,
        e.description,
        e.amount,
        e.currency_code,
        e.merchant,
        e.notes,
        e.created_at,
        e.updated_at,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = e.owner_id
            and ea.entity_type = 'expense'
            and ea.entity_id = e.id
        ) as attachment_count,
        c.id as category_id,
        c.name as category_name,
        c.icon as category_icon,
        c.color as category_color,
        c.is_archived as category_archived,
        pm.id as payment_method_id,
        pm.name as payment_name,
        pm.icon as payment_icon,
        pm.is_archived as payment_archived,
        coalesce(
          (
            select array_agg(t.name order by t.normalized_name)
            from expense_tags et
            inner join tags t
              on t.owner_id = et.owner_id
              and t.id = et.tag_id
            where et.owner_id = e.owner_id
              and et.expense_id = e.id
          ),
          array[]::text[]
        ) as tags
      from expenses e
      inner join categories c
        on c.owner_id = e.owner_id
        and c.id = e.category_id
      inner join payment_methods pm
        on pm.owner_id = e.owner_id
        and pm.id = e.payment_method_id
      where ${sql.join(conditions, sql` and `)}
      order by ${orderBy}
      limit ${filters.limit + 1}
    `.execute(this.database);

    const hasMore = result.rows.length > filters.limit;
    return {
      hasMore,
      items: result.rows.slice(0, filters.limit).map(mapExpense),
    };
  }

  async getExpense(
    ownerId: string,
    expenseId: string,
  ): Promise<ExpenseRecord | null> {
    const result = await sql<ExpenseRow>`
      select
        e.id,
        e.expense_date,
        e.description,
        e.amount,
        e.currency_code,
        e.merchant,
        e.notes,
        e.created_at,
        e.updated_at,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = e.owner_id
            and ea.entity_type = 'expense'
            and ea.entity_id = e.id
        ) as attachment_count,
        c.id as category_id,
        c.name as category_name,
        c.icon as category_icon,
        c.color as category_color,
        c.is_archived as category_archived,
        pm.id as payment_method_id,
        pm.name as payment_name,
        pm.icon as payment_icon,
        pm.is_archived as payment_archived,
        coalesce(
          (
            select array_agg(t.name order by t.normalized_name)
            from expense_tags et
            inner join tags t
              on t.owner_id = et.owner_id
              and t.id = et.tag_id
            where et.owner_id = e.owner_id
              and et.expense_id = e.id
          ),
          array[]::text[]
        ) as tags
      from expenses e
      inner join categories c
        on c.owner_id = e.owner_id
        and c.id = e.category_id
      inner join payment_methods pm
        on pm.owner_id = e.owner_id
        and pm.id = e.payment_method_id
      where e.owner_id = ${ownerId}::uuid
        and e.id = ${expenseId}::uuid
        and e.deleted_at is null
      limit 1
    `.execute(this.database);

    const row = result.rows[0];
    return row ? mapExpense(row) : null;
  }

  async createExpense(
    input: CreateExpenseStoreInput,
  ): Promise<CreateExpenseResult> {
    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('expense_creation_requests')
        .values({
          expense_id: input.expenseId,
          idempotency_key: input.idempotencyKey,
          owner_id: input.ownerId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('expense_id')
        .executeTakeFirst();

      if (!request) {
        const existing = await transaction
          .selectFrom('expense_creation_requests')
          .select(['expense_id', 'request_hash'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirstOrThrow();
        if (existing.request_hash.trim() !== input.requestHash) {
          return {
            expenseId: existing.expense_id,
            mismatched: true,
            replayed: false,
          };
        }
        return {
          expenseId: existing.expense_id,
          mismatched: false,
          replayed: true,
        };
      }

      const [currency, category, paymentMethodId] = await Promise.all([
        transaction
          .selectFrom('app_settings')
          .select('default_currency')
          .where('owner_id', '=', input.ownerId)
          .executeTakeFirstOrThrow(),
        transaction
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.categoryId)
          .where('is_archived', '=', false)
          .executeTakeFirst(),
        this.resolvePaymentMethod(
          transaction,
          input.ownerId,
          input.paymentMethodId,
        ),
      ]);
      if (!category || !paymentMethodId) {
        throw new Error('EXPENSE_OPTION_INVALID');
      }

      await transaction
        .insertInto('expenses')
        .values({
          amount: input.amount,
          category_id: input.categoryId,
          currency_code: currency.default_currency,
          description: input.description,
          expense_date: input.date,
          id: input.expenseId,
          merchant: input.merchant,
          notes: input.notes,
          owner_id: input.ownerId,
          payment_method_id: paymentMethodId,
        })
        .executeTakeFirstOrThrow();
      await this.replaceTags(
        transaction,
        input.ownerId,
        input.expenseId,
        input.tags,
      );
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'expense.created',
          id: randomUUID(),
          metadata: { expenseId: input.expenseId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();

      return {
        expenseId: input.expenseId,
        mismatched: false,
        replayed: false,
      };
    });
  }

  async importExpenses(
    input: ImportExpensesStoreInput,
  ): Promise<ImportExpensesStoreResult> {
    const currencyCounts = input.rows.reduce<Record<string, number>>(
      (counts, row) => {
        counts[row.currencyCode] = (counts[row.currencyCode] ?? 0) + 1;
        return counts;
      },
      {},
    );

    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('expense_import_requests')
        .values({
          currency_counts: currencyCounts,
          idempotency_key: input.idempotencyKey,
          imported_count: input.rows.length,
          owner_id: input.ownerId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('idempotency_key')
        .executeTakeFirst();

      if (!request) {
        const existing = await transaction
          .selectFrom('expense_import_requests')
          .select(['currency_counts', 'imported_count', 'request_hash'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirstOrThrow();
        const existingCounts = Object.fromEntries(
          Object.entries(existing.currency_counts).map(([code, count]) => [
            code,
            Number(count),
          ]),
        );
        return {
          currencyCounts: existingCounts,
          importedCount: existing.imported_count,
          mismatched: existing.request_hash.trim() !== input.requestHash,
          replayed: existing.request_hash.trim() === input.requestHash,
        };
      }

      const [categories, paymentMethods] = await Promise.all([
        transaction
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('is_archived', '=', false)
          .execute(),
        transaction
          .selectFrom('payment_methods')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('is_archived', '=', false)
          .execute(),
      ]);
      const categoryIds = new Set(categories.map((item) => item.id));
      const paymentMethodIds = new Set(paymentMethods.map((item) => item.id));
      if (
        input.rows.some(
          (row) =>
            !categoryIds.has(row.categoryId) ||
            !paymentMethodIds.has(row.paymentMethodId ?? ''),
        )
      ) {
        throw new Error('EXPENSE_OPTION_INVALID');
      }

      for (const row of input.rows) {
        const expenseId = randomUUID();
        await transaction
          .insertInto('expenses')
          .values({
            amount: row.amount,
            category_id: row.categoryId,
            created_at: input.now,
            currency_code: row.currencyCode,
            description: row.description,
            expense_date: row.date,
            id: expenseId,
            merchant: row.merchant,
            notes: row.notes,
            owner_id: input.ownerId,
            payment_method_id: row.paymentMethodId!,
            updated_at: input.now,
          })
          .executeTakeFirstOrThrow();
        await this.replaceTags(transaction, input.ownerId, expenseId, row.tags);
      }

      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'expense.imported',
          id: randomUUID(),
          metadata: {
            currencyCounts,
            importedCount: input.rows.length,
          },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();

      return {
        currencyCounts,
        importedCount: input.rows.length,
        mismatched: false,
        replayed: false,
      };
    });
  }

  async updateExpense(input: UpdateExpenseStoreInput): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const [category, paymentMethodId] = await Promise.all([
        transaction
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.categoryId)
          .executeTakeFirst(),
        this.resolvePaymentMethod(
          transaction,
          input.ownerId,
          input.paymentMethodId,
          true,
        ),
      ]);
      if (!category || !paymentMethodId) {
        throw new Error('EXPENSE_OPTION_INVALID');
      }

      const result = await transaction
        .updateTable('expenses')
        .set({
          amount: input.amount,
          category_id: input.categoryId,
          description: input.description,
          expense_date: input.date,
          merchant: input.merchant,
          notes: input.notes,
          payment_method_id: paymentMethodId,
          updated_at: input.now,
        })
        .where('id', '=', input.expenseId)
        .where('owner_id', '=', input.ownerId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        return false;
      }

      await this.replaceTags(
        transaction,
        input.ownerId,
        input.expenseId,
        input.tags,
      );
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'expense.updated',
          id: randomUUID(),
          metadata: { expenseId: input.expenseId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async deleteExpense(input: {
    expenseId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const attachments = await transaction
        .selectFrom('attachments as attachment')
        .innerJoin('entity_attachments as link', (join) =>
          join
            .onRef('link.owner_id', '=', 'attachment.owner_id')
            .onRef('link.attachment_id', '=', 'attachment.id')
            .on('link.entity_type', '=', 'expense')
            .on('link.entity_id', '=', input.expenseId),
        )
        .select([
          'attachment.id',
          'attachment.mime_type',
          'attachment.object_key',
          'attachment.storage_provider',
          'attachment.storage_root',
        ])
        .where('attachment.owner_id', '=', input.ownerId)
        .where('attachment.deleted_at', 'is', null)
        .execute();
      const result = await transaction
        .updateTable('expenses')
        .set({ deleted_at: input.now, updated_at: input.now })
        .where('id', '=', input.expenseId)
        .where('owner_id', '=', input.ownerId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        return false;
      }
      for (const attachment of attachments) {
        await transaction
          .updateTable('attachments')
          .set({ deleted_at: input.now, updated_at: input.now })
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', attachment.id)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('attachment_cleanup_jobs')
          .values(
            attachmentObjectKeys(
              attachment.object_key,
              attachment.mime_type,
            ).map((objectKey) => ({
              attachment_id: attachment.id,
              id: randomUUID(),
              last_error_code: null,
              object_key: objectKey,
              owner_id: input.ownerId,
              storage_provider: attachment.storage_provider,
              storage_root: attachment.storage_root,
            })),
          )
          .executeTakeFirstOrThrow();
      }
      await transaction
        .deleteFrom('entity_attachments')
        .where('owner_id', '=', input.ownerId)
        .where('entity_type', '=', 'expense')
        .where('entity_id', '=', input.expenseId)
        .execute();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'expense.deleted',
          id: randomUUID(),
          metadata: { expenseId: input.expenseId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async getSummary(input: {
    monthEnd: string;
    monthStart: string;
    ownerId: string;
  }): Promise<{
    count: number;
    currencyGroups: Array<{
      categories: CategorySummary[];
      currencyCode: string;
      totalAmount: string;
    }>;
    defaultCurrency: string;
  }> {
    const [totalResult, categoryResult, settings] = await Promise.all([
      sql<{
        count: string;
        currency_code: string;
        total_amount: string;
      }>`
        select
          count(*)::text as count,
          currency_code,
          coalesce(sum(amount), 0)::text as total_amount
        from expenses
        where owner_id = ${input.ownerId}::uuid
          and deleted_at is null
          and expense_date >= ${input.monthStart}::date
          and expense_date < ${input.monthEnd}::date
        group by currency_code
      `.execute(this.database),
      sql<{
        amount: string;
        color: string;
        currency_code: string;
        id: string;
        name: string;
      }>`
        select
          c.id,
          c.name,
          c.color,
          e.currency_code,
          sum(e.amount)::text as amount
        from expenses e
        inner join categories c
          on c.owner_id = e.owner_id
          and c.id = e.category_id
        where e.owner_id = ${input.ownerId}::uuid
          and e.deleted_at is null
          and e.expense_date >= ${input.monthStart}::date
          and e.expense_date < ${input.monthEnd}::date
        group by e.currency_code, c.id, c.name, c.color
        order by e.currency_code, sum(e.amount) desc, c.name asc
      `.execute(this.database),
      this.database
        .selectFrom('app_settings')
        .select('default_currency')
        .where('owner_id', '=', input.ownerId)
        .executeTakeFirstOrThrow(),
    ]);
    const defaultCurrency = settings.default_currency.trim();
    const totals =
      totalResult.rows.length > 0
        ? totalResult.rows
        : [
            {
              count: '0',
              currency_code: defaultCurrency,
              total_amount: '0',
            },
          ];
    return {
      count: totalResult.rows.reduce(
        (count, total) => count + Number(total.count),
        0,
      ),
      currencyGroups: totals
        .map((total) => ({
          categories: categoryResult.rows
            .filter(
              (category) =>
                category.currency_code.trim() === total.currency_code.trim(),
            )
            .map((category) => ({
              amount: category.amount,
              color: category.color.trim(),
              id: category.id,
              name: category.name,
            })),
          currencyCode: total.currency_code.trim(),
          totalAmount: total.total_amount,
        }))
        .sort((left, right) =>
          left.currencyCode === defaultCurrency
            ? -1
            : right.currencyCode === defaultCurrency
              ? 1
              : left.currencyCode.localeCompare(right.currencyCode),
        ),
      defaultCurrency,
    };
  }

  private async resolvePaymentMethod(
    transaction: Transaction<DatabaseSchema>,
    ownerId: string,
    paymentMethodId: string | null,
    includeArchived = false,
  ): Promise<string | null> {
    let query = transaction
      .selectFrom('payment_methods')
      .select('id')
      .where('owner_id', '=', ownerId);
    if (!includeArchived) {
      query = query.where('is_archived', '=', false);
    }
    if (paymentMethodId) {
      query = query.where('id', '=', paymentMethodId);
    } else {
      query = query.orderBy(
        sql`case when normalized_name = 'other' then 0 else 1 end`,
      );
      query = query.orderBy('normalized_name').limit(1);
    }
    const result = await query.executeTakeFirst();
    return result?.id ?? null;
  }

  private async replaceTags(
    transaction: Transaction<DatabaseSchema>,
    ownerId: string,
    expenseId: string,
    tagNames: string[],
  ): Promise<void> {
    await transaction
      .deleteFrom('expense_tags')
      .where('owner_id', '=', ownerId)
      .where('expense_id', '=', expenseId)
      .execute();

    for (const name of tagNames) {
      const tag = await transaction
        .insertInto('tags')
        .values({
          id: randomUUID(),
          name,
          normalized_name: normalizeName(name),
          owner_id: ownerId,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['owner_id', 'normalized_name'])
            .doUpdateSet({ name }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('expense_tags')
        .values({
          expense_id: expenseId,
          owner_id: ownerId,
          tag_id: tag.id,
        })
        .executeTakeFirstOrThrow();
    }
  }
}

export { cursorValue };
