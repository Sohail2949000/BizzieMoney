import { randomUUID } from 'node:crypto';

import {
  sql,
  type BizzieMoneyDatabase,
  type DatabaseSchema,
  type Transaction,
} from '@bizziemoney/database';

import { attachmentObjectKeys } from '../attachments/thumbnail-keys';
import type {
  DebtCursor,
  DebtFilters,
  DebtPage,
  DebtPaymentPage,
  DebtPaymentRecord,
  DebtPaymentWriteInput,
  DebtRecord,
  DebtSort,
  DebtStatus,
  DebtSummary,
  DebtUpcomingResponse,
  DebtWriteInput,
} from './types';

interface DebtRow {
  attachment_count: number;
  created_at: Date;
  currency_code: string;
  custom_interval_days: number | null;
  direction: DebtRecord['direction'];
  due_date: Date | string | null;
  id: string;
  installment_amount: string | null;
  installment_frequency: DebtRecord['installmentFrequency'];
  interest_note: string | null;
  name: string;
  next_payment_date: Date | string | null;
  notes: string | null;
  original_amount: string;
  overpaid_amount: string;
  paid_amount: string;
  remaining_amount: string;
  start_date: Date | string;
  status: DebtRecord['status'];
  updated_at: Date;
}

interface DebtPaymentRow {
  amount: string;
  attachment_count: number;
  created_at: Date;
  currency_code: string;
  debt_id: string;
  debt_name: string;
  id: string;
  notes: string | null;
  payment_date: Date | string;
  updated_at: Date;
}

interface AttachmentCleanupRow {
  id: string;
  mime_type: string;
  object_key: string;
  storage_provider: 'local' | 's3';
  storage_root: string;
}

interface CreateDebtStoreInput extends DebtWriteInput {
  debtId: string;
  now: Date;
  ownerId: string;
  sessionId: string;
  today: string;
}

interface UpdateDebtStoreInput extends DebtWriteInput {
  debtId: string;
  now: Date;
  ownerId: string;
  sessionId: string;
  today: string;
}

interface RecordDebtPaymentStoreInput extends DebtPaymentWriteInput {
  debtId: string;
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  paymentId: string;
  requestHash: string;
  sessionId: string;
  today: string;
}

interface UpdateDebtPaymentStoreInput extends DebtPaymentWriteInput {
  now: Date;
  ownerId: string;
  paymentId: string;
  sessionId: string;
  today: string;
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function nullableDateOnly(value: Date | string | null): string | null {
  return value === null ? null : dateOnly(value);
}

function mapDebt(row: DebtRow): DebtRecord {
  return {
    attachmentCount: Number(row.attachment_count),
    createdAt: row.created_at,
    currencyCode: row.currency_code.trim(),
    customIntervalDays: row.custom_interval_days,
    direction: row.direction,
    dueDate: nullableDateOnly(row.due_date),
    id: row.id,
    installmentAmount: row.installment_amount,
    installmentFrequency: row.installment_frequency,
    interestNote: row.interest_note,
    name: row.name,
    nextPaymentDate: nullableDateOnly(row.next_payment_date),
    notes: row.notes,
    originalAmount: row.original_amount,
    overpaidAmount: row.overpaid_amount,
    paidAmount: row.paid_amount,
    remainingAmount: row.remaining_amount,
    startDate: dateOnly(row.start_date),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: DebtPaymentRow): DebtPaymentRecord {
  return {
    amount: row.amount,
    attachmentCount: Number(row.attachment_count),
    createdAt: row.created_at,
    currencyCode: row.currency_code.trim(),
    debtId: row.debt_id,
    debtName: row.debt_name,
    id: row.id,
    notes: row.notes,
    paymentDate: dateOnly(row.payment_date),
    updatedAt: row.updated_at,
  };
}

function dueDateFor(input: {
  dueDate: string | null;
  nextPaymentDate: string | null;
}): string | null {
  return input.nextPaymentDate ?? input.dueDate;
}

function openStatus(
  input: { dueDate: string | null; nextPaymentDate: string | null },
  today: string,
): 'active' | 'overdue' {
  const dueDate = dueDateFor(input);
  return dueDate !== null && dueDate < today ? 'overdue' : 'active';
}

export function debtCursorValue(debt: DebtRecord, sort: DebtSort): string {
  switch (sort) {
    case 'amount_desc':
      return debt.remainingAmount;
    case 'updated_desc':
      return debt.updatedAt.toISOString();
    case 'due_asc':
      return debt.nextPaymentDate ?? debt.dueDate ?? '9999-12-31';
  }
}

export interface DebtStore {
  changeStatus(input: {
    action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume';
    debtId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
    today: string;
  }): Promise<boolean>;
  createDebt(input: CreateDebtStoreInput): Promise<void>;
  deleteDebt(input: {
    debtId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean>;
  deletePayment(input: {
    now: Date;
    ownerId: string;
    paymentId: string;
    sessionId: string;
  }): Promise<boolean>;
  getDebt(ownerId: string, debtId: string): Promise<DebtRecord | null>;
  getPayment(
    ownerId: string,
    paymentId: string,
  ): Promise<DebtPaymentRecord | null>;
  getSummary(ownerId: string): Promise<DebtSummary>;
  getTimeZone(ownerId: string): Promise<string>;
  listDebts(ownerId: string, filters: DebtFilters): Promise<DebtPage>;
  listPayments(
    ownerId: string,
    debtId: string,
    cursor: DebtCursor | undefined,
    limit: number,
  ): Promise<DebtPaymentPage>;
  listUpcoming(
    ownerId: string,
    today: string,
    throughDate: string,
    limit: number,
  ): Promise<DebtUpcomingResponse>;
  recordPayment(input: RecordDebtPaymentStoreInput): Promise<{
    mismatched: boolean;
    paymentId: string;
    replayed: boolean;
  }>;
  refreshOverdueStatuses(
    ownerId: string,
    today: string,
    now: Date,
  ): Promise<void>;
  updateDebt(input: UpdateDebtStoreInput): Promise<boolean>;
  updatePayment(input: UpdateDebtPaymentStoreInput): Promise<boolean>;
}

export class PostgresDebtStore implements DebtStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getTimeZone(ownerId: string): Promise<string> {
    const settings = await this.database
      .selectFrom('app_settings')
      .select('time_zone')
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    return settings.time_zone;
  }

  async refreshOverdueStatuses(
    ownerId: string,
    today: string,
    now: Date,
  ): Promise<void> {
    await sql`
      update debts
      set
        status = case
          when coalesce(next_payment_date, due_date) < ${today}::date
            then 'overdue'
          else 'active'
        end,
        updated_at = ${now}
      where owner_id = ${ownerId}::uuid
        and deleted_at is null
        and status in ('active', 'overdue')
        and status <> case
          when coalesce(next_payment_date, due_date) < ${today}::date
            then 'overdue'
          else 'active'
        end
    `.execute(this.database);
  }

  async listDebts(ownerId: string, filters: DebtFilters): Promise<DebtPage> {
    const conditions = [
      sql<boolean>`d.owner_id = ${ownerId}::uuid`,
      sql<boolean>`d.deleted_at is null`,
      sql<boolean>`d.direction = ${filters.direction}`,
    ];
    if (filters.status) {
      conditions.push(sql<boolean>`d.status = ${filters.status}`);
    }
    if (filters.dateFrom && filters.dateTo) {
      conditions.push(sql<boolean>`(
        d.start_date between ${filters.dateFrom}::date and ${filters.dateTo}::date
        or coalesce(d.next_payment_date, d.due_date)
          between ${filters.dateFrom}::date and ${filters.dateTo}::date
        or exists (
          select 1
          from debt_payments activity_payment
          where activity_payment.owner_id = d.owner_id
            and activity_payment.debt_id = d.id
            and activity_payment.deleted_at is null
            and activity_payment.payment_date
              between ${filters.dateFrom}::date and ${filters.dateTo}::date
        )
      )`);
    } else if (filters.dateFrom) {
      conditions.push(sql<boolean>`(
        d.start_date >= ${filters.dateFrom}::date
        or coalesce(d.next_payment_date, d.due_date) >= ${filters.dateFrom}::date
        or exists (
          select 1
          from debt_payments activity_payment
          where activity_payment.owner_id = d.owner_id
            and activity_payment.debt_id = d.id
            and activity_payment.deleted_at is null
            and activity_payment.payment_date >= ${filters.dateFrom}::date
        )
      )`);
    } else if (filters.dateTo) {
      conditions.push(sql<boolean>`(
        d.start_date <= ${filters.dateTo}::date
        or coalesce(d.next_payment_date, d.due_date) <= ${filters.dateTo}::date
        or exists (
          select 1
          from debt_payments activity_payment
          where activity_payment.owner_id = d.owner_id
            and activity_payment.debt_id = d.id
            and activity_payment.deleted_at is null
            and activity_payment.payment_date <= ${filters.dateTo}::date
        )
      )`);
    }
    if (filters.search) {
      conditions.push(
        sql<boolean>`d.search_vector @@ websearch_to_tsquery('simple', ${filters.search})`,
      );
    }
    if (filters.cursor) {
      const cursor = filters.cursor;
      switch (filters.sort) {
        case 'due_asc':
          conditions.push(sql<boolean>`(
            coalesce(d.next_payment_date, d.due_date, '9999-12-31'::date)
              > ${cursor.value}::date
            or (
              coalesce(d.next_payment_date, d.due_date, '9999-12-31'::date)
                = ${cursor.value}::date
              and d.id > ${cursor.id}::uuid
            )
          )`);
          break;
        case 'amount_desc':
          conditions.push(sql<boolean>`(
            greatest(d.original_amount - balance.paid_amount, 0)
              < ${cursor.value}::numeric
            or (
              greatest(d.original_amount - balance.paid_amount, 0)
                = ${cursor.value}::numeric
              and d.id < ${cursor.id}::uuid
            )
          )`);
          break;
        case 'updated_desc':
          conditions.push(sql<boolean>`(
            d.updated_at < ${cursor.value}::timestamptz
            or (
              d.updated_at = ${cursor.value}::timestamptz
              and d.id < ${cursor.id}::uuid
            )
          )`);
          break;
      }
    }

    let orderBy = sql`coalesce(
      d.next_payment_date,
      d.due_date,
      '9999-12-31'::date
    ) asc, d.id asc`;
    if (filters.sort === 'amount_desc') {
      orderBy = sql`greatest(
        d.original_amount - balance.paid_amount,
        0
      ) desc, d.id desc`;
    } else if (filters.sort === 'updated_desc') {
      orderBy = sql`d.updated_at desc, d.id desc`;
    }

    const result = await sql<DebtRow>`
      select
        d.id,
        d.direction,
        d.name,
        d.original_amount::text as original_amount,
        d.currency_code,
        d.start_date,
        d.due_date,
        d.installment_amount::text as installment_amount,
        d.installment_frequency,
        d.custom_interval_days,
        d.next_payment_date,
        d.interest_note,
        d.status,
        d.notes,
        d.created_at,
        d.updated_at,
        balance.paid_amount::text as paid_amount,
        greatest(
          d.original_amount - balance.paid_amount,
          0
        )::numeric(19,4)::text
          as remaining_amount,
        greatest(
          balance.paid_amount - d.original_amount,
          0
        )::numeric(19,4)::text
          as overpaid_amount,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = d.owner_id
            and ea.entity_type = 'debt'
            and ea.entity_id = d.id
        ) as attachment_count
      from debts d
      cross join lateral (
        select coalesce(sum(p.amount), 0) as paid_amount
        from debt_payments p
        where p.owner_id = d.owner_id
          and p.debt_id = d.id
          and p.deleted_at is null
      ) balance
      where ${sql.join(conditions, sql` and `)}
      order by ${orderBy}
      limit ${filters.limit + 1}
    `.execute(this.database);
    return {
      hasMore: result.rows.length > filters.limit,
      items: result.rows.slice(0, filters.limit).map(mapDebt),
    };
  }

  async getDebt(ownerId: string, debtId: string): Promise<DebtRecord | null> {
    const result = await sql<DebtRow>`
      select
        d.id,
        d.direction,
        d.name,
        d.original_amount::text as original_amount,
        d.currency_code,
        d.start_date,
        d.due_date,
        d.installment_amount::text as installment_amount,
        d.installment_frequency,
        d.custom_interval_days,
        d.next_payment_date,
        d.interest_note,
        d.status,
        d.notes,
        d.created_at,
        d.updated_at,
        balance.paid_amount::text as paid_amount,
        greatest(
          d.original_amount - balance.paid_amount,
          0
        )::numeric(19,4)::text
          as remaining_amount,
        greatest(
          balance.paid_amount - d.original_amount,
          0
        )::numeric(19,4)::text
          as overpaid_amount,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = d.owner_id
            and ea.entity_type = 'debt'
            and ea.entity_id = d.id
        ) as attachment_count
      from debts d
      cross join lateral (
        select coalesce(sum(p.amount), 0) as paid_amount
        from debt_payments p
        where p.owner_id = d.owner_id
          and p.debt_id = d.id
          and p.deleted_at is null
      ) balance
      where d.owner_id = ${ownerId}::uuid
        and d.id = ${debtId}::uuid
        and d.deleted_at is null
      limit 1
    `.execute(this.database);
    const row = result.rows[0];
    return row ? mapDebt(row) : null;
  }

  async createDebt(input: CreateDebtStoreInput): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const settings = await transaction
        .selectFrom('app_settings')
        .select('default_currency')
        .where('owner_id', '=', input.ownerId)
        .executeTakeFirstOrThrow();
      const status = openStatus(input, input.today);
      await transaction
        .insertInto('debts')
        .values({
          completed_at: null,
          currency_code: settings.default_currency,
          custom_interval_days: input.customIntervalDays,
          direction: input.direction,
          due_date: input.dueDate,
          id: input.debtId,
          installment_amount: input.installmentAmount,
          installment_frequency: input.installmentFrequency,
          interest_note: input.interestNote,
          name: input.name,
          next_payment_date: input.nextPaymentDate,
          notes: input.notes,
          original_amount: input.originalAmount,
          owner_id: input.ownerId,
          start_date: input.startDate,
          status,
        })
        .executeTakeFirstOrThrow();
      await this.audit(transaction, {
        eventType: 'debt.created',
        metadata: { debtId: input.debtId, direction: input.direction },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
    });
  }

  async updateDebt(input: UpdateDebtStoreInput): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom('debts')
        .select(['id', 'status'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) return false;
      const balance = await sql<{ exceeds: boolean }>`
        select coalesce(sum(amount), 0) > ${input.originalAmount}::numeric
          as exceeds
        from debt_payments
        where owner_id = ${input.ownerId}::uuid
          and debt_id = ${input.debtId}::uuid
          and deleted_at is null
      `.execute(transaction);
      if (balance.rows[0]?.exceeds) {
        throw new Error('DEBT_ORIGINAL_BELOW_PAID');
      }
      const status =
        existing.status === 'active' || existing.status === 'overdue'
          ? openStatus(input, input.today)
          : existing.status;
      await transaction
        .updateTable('debts')
        .set({
          custom_interval_days: input.customIntervalDays,
          direction: input.direction,
          due_date: input.dueDate,
          installment_amount: input.installmentAmount,
          installment_frequency: input.installmentFrequency,
          interest_note: input.interestNote,
          name: input.name,
          next_payment_date: input.nextPaymentDate,
          notes: input.notes,
          original_amount: input.originalAmount,
          start_date: input.startDate,
          status,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .executeTakeFirstOrThrow();
      await this.audit(transaction, {
        eventType: 'debt.updated',
        metadata: { debtId: input.debtId },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      return true;
    });
  }

  async changeStatus(input: {
    action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume';
    debtId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
    today: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const debt = await transaction
        .selectFrom('debts')
        .select(['due_date', 'next_payment_date', 'original_amount', 'status'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!debt) return false;
      const valid =
        (input.action === 'pause' &&
          ['active', 'overdue'].includes(debt.status)) ||
        (input.action === 'resume' && debt.status === 'paused') ||
        (input.action === 'cancel' &&
          ['active', 'overdue', 'paused'].includes(debt.status)) ||
        (input.action === 'complete' &&
          ['active', 'overdue', 'paused'].includes(debt.status)) ||
        (input.action === 'reopen' && debt.status === 'paid');
      if (!valid) throw new Error('DEBT_STATUS_CONFLICT');
      if (input.action === 'reopen') {
        const balance = await sql<{ fully_paid: boolean }>`
          select coalesce(sum(amount), 0) >= ${debt.original_amount}::numeric
            as fully_paid
          from debt_payments
          where owner_id = ${input.ownerId}::uuid
            and debt_id = ${input.debtId}::uuid
            and deleted_at is null
        `.execute(transaction);
        if (balance.rows[0]?.fully_paid) {
          throw new Error('DEBT_REOPEN_BALANCE_COMPLETE');
        }
      }

      let status: DebtStatus;
      if (input.action === 'pause') status = 'paused';
      else if (input.action === 'cancel') status = 'cancelled';
      else if (input.action === 'complete') status = 'paid';
      else {
        status = openStatus(
          {
            dueDate: nullableDateOnly(debt.due_date),
            nextPaymentDate: nullableDateOnly(debt.next_payment_date),
          },
          input.today,
        );
      }
      await transaction
        .updateTable('debts')
        .set({
          completed_at: status === 'paid' ? input.now : null,
          status,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .executeTakeFirstOrThrow();
      const pastTense = {
        cancel: 'cancelled',
        complete: 'completed',
        pause: 'paused',
        reopen: 'reopened',
        resume: 'resumed',
      }[input.action];
      await this.audit(transaction, {
        eventType: `debt.${pastTense}`,
        metadata: { debtId: input.debtId },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      return true;
    });
  }

  async recordPayment(input: RecordDebtPaymentStoreInput): Promise<{
    mismatched: boolean;
    paymentId: string;
    replayed: boolean;
  }> {
    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('debt_payment_requests')
        .values({
          idempotency_key: input.idempotencyKey,
          owner_id: input.ownerId,
          payment_id: input.paymentId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('payment_id')
        .executeTakeFirst();
      if (!request) {
        const existing = await transaction
          .selectFrom('debt_payment_requests')
          .select(['payment_id', 'request_hash'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirstOrThrow();
        return {
          mismatched: existing.request_hash.trim() !== input.requestHash,
          paymentId: existing.payment_id,
          replayed: existing.request_hash.trim() === input.requestHash,
        };
      }

      const debt = await transaction
        .selectFrom('debts')
        .select(['due_date', 'next_payment_date', 'original_amount', 'status'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!debt) throw new Error('DEBT_NOT_FOUND');
      if (!['active', 'overdue'].includes(debt.status)) {
        throw new Error('DEBT_PAYMENT_STATUS_INVALID');
      }
      const balance = await sql<{ completes: boolean; exceeds: boolean }>`
        select
          coalesce(sum(amount), 0) + ${input.amount}::numeric
            >= ${debt.original_amount}::numeric as completes,
          coalesce(sum(amount), 0) + ${input.amount}::numeric
            > ${debt.original_amount}::numeric as exceeds
        from debt_payments
        where owner_id = ${input.ownerId}::uuid
          and debt_id = ${input.debtId}::uuid
          and deleted_at is null
      `.execute(transaction);
      const calculated = balance.rows[0]!;
      if (calculated.exceeds && !input.allowOverpayment) {
        throw new Error('DEBT_PAYMENT_EXCEEDS_REMAINING');
      }

      await transaction
        .insertInto('debt_payments')
        .values({
          amount: input.amount,
          debt_id: input.debtId,
          id: input.paymentId,
          notes: input.notes,
          owner_id: input.ownerId,
          payment_date: input.paymentDate,
        })
        .executeTakeFirstOrThrow();
      const open = openStatus(
        {
          dueDate: nullableDateOnly(debt.due_date),
          nextPaymentDate: nullableDateOnly(debt.next_payment_date),
        },
        input.today,
      );
      await transaction
        .updateTable('debts')
        .set({
          completed_at: calculated.completes ? input.now : null,
          status: calculated.completes ? 'paid' : open,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .executeTakeFirstOrThrow();
      await this.audit(transaction, {
        eventType: 'debt.payment_recorded',
        metadata: {
          debtId: input.debtId,
          overpaymentConfirmed: calculated.exceeds,
          paymentId: input.paymentId,
        },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      if (calculated.completes) {
        await this.audit(transaction, {
          eventType: 'debt.completed',
          metadata: { debtId: input.debtId, source: 'payment' },
          ownerId: input.ownerId,
          sessionId: input.sessionId,
        });
      }
      return {
        mismatched: false,
        paymentId: input.paymentId,
        replayed: false,
      };
    });
  }

  async updatePayment(input: UpdateDebtPaymentStoreInput): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const payment = await transaction
        .selectFrom('debt_payments')
        .select(['debt_id', 'id'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.paymentId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!payment) return false;
      const debt = await transaction
        .selectFrom('debts')
        .select(['due_date', 'next_payment_date', 'original_amount', 'status'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', payment.debt_id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!debt) return false;
      const balance = await sql<{ completes: boolean; exceeds: boolean }>`
        select
          coalesce(sum(amount) filter (
            where id <> ${input.paymentId}::uuid
          ), 0) + ${input.amount}::numeric
            >= ${debt.original_amount}::numeric as completes,
          coalesce(sum(amount) filter (
            where id <> ${input.paymentId}::uuid
          ), 0) + ${input.amount}::numeric
            > ${debt.original_amount}::numeric as exceeds
        from debt_payments
        where owner_id = ${input.ownerId}::uuid
          and debt_id = ${payment.debt_id}::uuid
          and deleted_at is null
      `.execute(transaction);
      const calculated = balance.rows[0]!;
      if (calculated.exceeds && !input.allowOverpayment) {
        throw new Error('DEBT_PAYMENT_EXCEEDS_REMAINING');
      }
      await transaction
        .updateTable('debt_payments')
        .set({
          amount: input.amount,
          notes: input.notes,
          payment_date: input.paymentDate,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.paymentId)
        .executeTakeFirstOrThrow();
      if (debt.status === 'active' || debt.status === 'overdue') {
        const status = calculated.completes
          ? 'paid'
          : openStatus(
              {
                dueDate: nullableDateOnly(debt.due_date),
                nextPaymentDate: nullableDateOnly(debt.next_payment_date),
              },
              input.today,
            );
        await transaction
          .updateTable('debts')
          .set({
            completed_at: calculated.completes ? input.now : null,
            status,
            updated_at: input.now,
          })
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', payment.debt_id)
          .executeTakeFirstOrThrow();
      }
      await this.audit(transaction, {
        eventType: 'debt.payment_updated',
        metadata: {
          debtId: payment.debt_id,
          overpaymentConfirmed: calculated.exceeds,
          paymentId: input.paymentId,
        },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      return true;
    });
  }

  async deletePayment(input: {
    now: Date;
    ownerId: string;
    paymentId: string;
    sessionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const payment = await transaction
        .selectFrom('debt_payments')
        .select(['debt_id', 'id'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.paymentId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!payment) return false;
      await this.cleanupEntityAttachments(transaction, {
        entityId: input.paymentId,
        entityType: 'debt_payment',
        now: input.now,
        ownerId: input.ownerId,
      });
      await transaction
        .updateTable('debt_payments')
        .set({ deleted_at: input.now, updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.paymentId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('debts')
        .set({ updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', payment.debt_id)
        .executeTakeFirstOrThrow();
      await this.audit(transaction, {
        eventType: 'debt.payment_deleted',
        metadata: { debtId: payment.debt_id, paymentId: input.paymentId },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      return true;
    });
  }

  async listPayments(
    ownerId: string,
    debtId: string,
    cursor: DebtCursor | undefined,
    limit: number,
  ): Promise<DebtPaymentPage> {
    const cursorCondition = cursor
      ? sql<boolean>`and (
          p.payment_date < ${cursor.value}::date
          or (
            p.payment_date = ${cursor.value}::date
            and p.id < ${cursor.id}::uuid
          )
        )`
      : sql<boolean>``;
    const result = await sql<DebtPaymentRow>`
      select
        p.id,
        p.debt_id,
        d.name as debt_name,
        p.payment_date,
        p.amount::text as amount,
        p.notes,
        p.created_at,
        p.updated_at,
        d.currency_code,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = p.owner_id
            and ea.entity_type = 'debt_payment'
            and ea.entity_id = p.id
        ) as attachment_count
      from debt_payments p
      inner join debts d
        on d.owner_id = p.owner_id
        and d.id = p.debt_id
      where p.owner_id = ${ownerId}::uuid
        and p.debt_id = ${debtId}::uuid
        and p.deleted_at is null
        and d.deleted_at is null
        ${cursorCondition}
      order by p.payment_date desc, p.id desc
      limit ${limit + 1}
    `.execute(this.database);
    return {
      hasMore: result.rows.length > limit,
      items: result.rows.slice(0, limit).map(mapPayment),
    };
  }

  async getPayment(
    ownerId: string,
    paymentId: string,
  ): Promise<DebtPaymentRecord | null> {
    const result = await sql<DebtPaymentRow>`
      select
        p.id,
        p.debt_id,
        d.name as debt_name,
        p.payment_date,
        p.amount::text as amount,
        p.notes,
        p.created_at,
        p.updated_at,
        d.currency_code,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = p.owner_id
            and ea.entity_type = 'debt_payment'
            and ea.entity_id = p.id
        ) as attachment_count
      from debt_payments p
      inner join debts d
        on d.owner_id = p.owner_id
        and d.id = p.debt_id
      where p.owner_id = ${ownerId}::uuid
        and p.id = ${paymentId}::uuid
        and p.deleted_at is null
        and d.deleted_at is null
      limit 1
    `.execute(this.database);
    const row = result.rows[0];
    return row ? mapPayment(row) : null;
  }

  async getSummary(ownerId: string): Promise<DebtSummary> {
    const result = await sql<{
      currency_code: string;
      i_owe: string;
      owed_to_me: string;
    }>`
      select
        d.currency_code,
        coalesce(sum(
          greatest(d.original_amount - balance.paid_amount, 0)
        ) filter (
          where d.direction = 'i_owe' and d.status <> 'cancelled'
        ), 0)::numeric(19,4)::text as i_owe,
        coalesce(sum(
          greatest(d.original_amount - balance.paid_amount, 0)
        ) filter (
          where d.direction = 'owed_to_me' and d.status <> 'cancelled'
        ), 0)::numeric(19,4)::text as owed_to_me
      from debts d
      left join lateral (
        select coalesce(sum(p.amount), 0) as paid_amount
        from debt_payments p
        where p.owner_id = d.owner_id
          and p.debt_id = d.id
          and p.deleted_at is null
      ) balance on true
      where d.owner_id = ${ownerId}::uuid
        and d.deleted_at is null
      group by d.currency_code
    `.execute(this.database);
    const settings = await this.database
      .selectFrom('app_settings')
      .select('default_currency')
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const defaultCurrency = settings.default_currency.trim();
    const rows =
      result.rows.length > 0
        ? result.rows
        : [
            {
              currency_code: defaultCurrency,
              i_owe: '0',
              owed_to_me: '0',
            },
          ];
    return {
      currencyGroups: rows
        .map((row) => ({
          currencyCode: row.currency_code.trim(),
          iOwe: row.i_owe,
          owedToMe: row.owed_to_me,
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

  async listUpcoming(
    ownerId: string,
    today: string,
    throughDate: string,
    limit: number,
  ): Promise<DebtUpcomingResponse> {
    const result = await sql<{
      amount: string;
      currency_code: string;
      days_until_due: number;
      direction: DebtRecord['direction'];
      due_date: Date | string;
      id: string;
      name: string;
      overdue_count: string;
      status: 'active' | 'overdue';
    }>`
      select
        d.id,
        d.name,
        d.direction,
        d.currency_code,
        d.status,
        coalesce(d.next_payment_date, d.due_date) as due_date,
        least(
          coalesce(
            d.installment_amount,
            greatest(d.original_amount - balance.paid_amount, 0)
          ),
          greatest(d.original_amount - balance.paid_amount, 0)
        )::numeric(19,4)::text as amount,
        (
          coalesce(d.next_payment_date, d.due_date) - ${today}::date
        )::integer as days_until_due,
        count(*) filter (where d.status = 'overdue') over ()::text
          as overdue_count
      from debts d
      cross join lateral (
        select coalesce(sum(p.amount), 0) as paid_amount
        from debt_payments p
        where p.owner_id = d.owner_id
          and p.debt_id = d.id
          and p.deleted_at is null
      ) balance
      where d.owner_id = ${ownerId}::uuid
        and d.deleted_at is null
        and d.status in ('active', 'overdue')
        and coalesce(d.next_payment_date, d.due_date) is not null
        and coalesce(d.next_payment_date, d.due_date)
          <= ${throughDate}::date
        and greatest(d.original_amount - balance.paid_amount, 0) > 0
      order by coalesce(d.next_payment_date, d.due_date) asc, d.id asc
      limit ${limit}
    `.execute(this.database);
    return {
      items: result.rows.map((row) => ({
        amount: row.amount,
        currencyCode: row.currency_code.trim(),
        daysUntilDue: Number(row.days_until_due),
        direction: row.direction,
        dueDate: dateOnly(row.due_date),
        id: row.id,
        name: row.name,
        status: row.status,
      })),
      overdueCount: Number(result.rows[0]?.overdue_count ?? 0),
    };
  }

  async deleteDebt(input: {
    debtId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const debt = await transaction
        .selectFrom('debts')
        .select('id')
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!debt) return false;
      const attachments = await sql<AttachmentCleanupRow>`
        select distinct
          a.id,
          a.object_key,
          a.storage_provider,
          a.storage_root
        from attachments a
        inner join entity_attachments ea
          on ea.owner_id = a.owner_id
          and ea.attachment_id = a.id
        where a.owner_id = ${input.ownerId}::uuid
          and a.deleted_at is null
          and (
            (ea.entity_type = 'debt' and ea.entity_id = ${input.debtId}::uuid)
            or
            (
              ea.entity_type = 'debt_payment'
              and exists (
                select 1
                from debt_payments p
                where p.owner_id = ea.owner_id
                  and p.id = ea.entity_id
                  and p.debt_id = ${input.debtId}::uuid
              )
            )
          )
      `.execute(transaction);
      await this.queueAttachmentCleanup(
        transaction,
        input.ownerId,
        input.now,
        attachments.rows,
      );
      await sql`
        delete from entity_attachments ea
        where ea.owner_id = ${input.ownerId}::uuid
          and (
            (ea.entity_type = 'debt' and ea.entity_id = ${input.debtId}::uuid)
            or
            (
              ea.entity_type = 'debt_payment'
              and exists (
                select 1
                from debt_payments p
                where p.owner_id = ea.owner_id
                  and p.id = ea.entity_id
                  and p.debt_id = ${input.debtId}::uuid
              )
            )
          )
      `.execute(transaction);
      await transaction
        .updateTable('debt_payments')
        .set({ deleted_at: input.now, updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('debt_id', '=', input.debtId)
        .where('deleted_at', 'is', null)
        .execute();
      await transaction
        .updateTable('debts')
        .set({
          completed_at: null,
          deleted_at: input.now,
          status: 'cancelled',
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.debtId)
        .executeTakeFirstOrThrow();
      await this.audit(transaction, {
        eventType: 'debt.deleted',
        metadata: { debtId: input.debtId },
        ownerId: input.ownerId,
        sessionId: input.sessionId,
      });
      return true;
    });
  }

  private async cleanupEntityAttachments(
    transaction: Transaction<DatabaseSchema>,
    input: {
      entityId: string;
      entityType: 'debt' | 'debt_payment';
      now: Date;
      ownerId: string;
    },
  ): Promise<void> {
    const attachments = await sql<AttachmentCleanupRow>`
      select
        a.id,
        a.mime_type,
        a.object_key,
        a.storage_provider,
        a.storage_root
      from attachments a
      inner join entity_attachments ea
        on ea.owner_id = a.owner_id
        and ea.attachment_id = a.id
      where a.owner_id = ${input.ownerId}::uuid
        and a.deleted_at is null
        and ea.entity_type = ${input.entityType}
        and ea.entity_id = ${input.entityId}::uuid
    `.execute(transaction);
    await this.queueAttachmentCleanup(
      transaction,
      input.ownerId,
      input.now,
      attachments.rows,
    );
    await transaction
      .deleteFrom('entity_attachments')
      .where('owner_id', '=', input.ownerId)
      .where('entity_type', '=', input.entityType)
      .where('entity_id', '=', input.entityId)
      .execute();
  }

  private async queueAttachmentCleanup(
    transaction: Transaction<DatabaseSchema>,
    ownerId: string,
    now: Date,
    attachments: AttachmentCleanupRow[],
  ): Promise<void> {
    for (const attachment of attachments) {
      await transaction
        .updateTable('attachments')
        .set({ deleted_at: now, updated_at: now })
        .where('owner_id', '=', ownerId)
        .where('id', '=', attachment.id)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('attachment_cleanup_jobs')
        .values(
          attachmentObjectKeys(attachment.object_key, attachment.mime_type).map(
            (objectKey) => ({
              attachment_id: attachment.id,
              id: randomUUID(),
              last_error_code: null,
              object_key: objectKey,
              owner_id: ownerId,
              storage_provider: attachment.storage_provider,
              storage_root: attachment.storage_root,
            }),
          ),
        )
        .executeTakeFirstOrThrow();
    }
  }

  private async audit(
    transaction: Transaction<DatabaseSchema>,
    input: {
      eventType: string;
      metadata: Record<string, unknown>;
      ownerId: string;
      sessionId: string;
    },
  ): Promise<void> {
    await transaction
      .insertInto('audit_events')
      .values({
        actor_session_id: input.sessionId,
        event_type: input.eventType,
        id: randomUUID(),
        metadata: input.metadata,
        owner_id: input.ownerId,
      })
      .executeTakeFirstOrThrow();
  }
}
