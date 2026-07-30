import { randomUUID } from 'node:crypto';

import {
  sql,
  type BizzieMoneyDatabase,
  type DatabaseSchema,
  type Transaction,
} from '@bizziemoney/database';

import { attachmentObjectKeys } from '../attachments/thumbnail-keys.js';
import { nextBillingDate, reminderDate } from './schedule.js';
import type {
  SubscriptionCursor,
  SubscriptionFilters,
  SubscriptionPage,
  SubscriptionPaymentPage,
  SubscriptionPaymentRecord,
  SubscriptionRecord,
  SubscriptionReminder,
  SubscriptionSort,
  SubscriptionUpcomingResponse,
  SubscriptionWriteInput,
} from './types.js';

interface SubscriptionRow {
  amount: string;
  attachment_count: number;
  auto_renew: boolean;
  billing_frequency: SubscriptionRecord['billingFrequency'];
  category_archived: boolean;
  category_color: string;
  category_icon: string;
  category_id: string;
  category_name: string;
  created_at: Date;
  currency_code: string;
  custom_interval_days: number | null;
  end_date: Date | string | null;
  id: string;
  name: string;
  next_payment_date: Date | string;
  notes: string | null;
  reminder_days: number;
  start_date: Date | string | null;
  status: SubscriptionRecord['status'];
  updated_at: Date;
}

interface PaymentRow {
  amount: string;
  converted_expense_id: string | null;
  created_at: Date;
  currency_code: string;
  id: string;
  paid_date: Date | string;
  scheduled_date: Date | string;
  subscription_id: string;
  subscription_name: string;
}

interface CreateSubscriptionStoreInput extends SubscriptionWriteInput {
  now: Date;
  ownerId: string;
  sessionId: string;
  subscriptionId: string;
}

interface UpdateSubscriptionStoreInput extends SubscriptionWriteInput {
  now: Date;
  ownerId: string;
  sessionId: string;
  subscriptionId: string;
}

interface RecordPaymentStoreInput {
  amount: string | null;
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  paidDate: string;
  paymentId: string;
  requestHash: string;
  sessionId: string;
  subscriptionId: string;
}

interface ConvertPaymentStoreInput {
  expenseId: string;
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  paymentId: string;
  paymentMethodId: string;
  requestHash: string;
  sessionId: string;
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function nullableDateOnly(value: Date | string | null): string | null {
  return value === null ? null : dateOnly(value);
}

function mapSubscription(row: SubscriptionRow): SubscriptionRecord {
  return {
    amount: row.amount,
    attachmentCount: Number(row.attachment_count),
    autoRenew: row.auto_renew,
    billingFrequency: row.billing_frequency,
    category: {
      archived: row.category_archived,
      color: row.category_color.trim(),
      icon: row.category_icon,
      id: row.category_id,
      name: row.category_name,
    },
    createdAt: row.created_at,
    currencyCode: row.currency_code.trim(),
    customIntervalDays: row.custom_interval_days,
    endDate: nullableDateOnly(row.end_date),
    id: row.id,
    name: row.name,
    nextPaymentDate: dateOnly(row.next_payment_date),
    notes: row.notes,
    reminderDays: row.reminder_days,
    startDate: nullableDateOnly(row.start_date),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: PaymentRow): SubscriptionPaymentRecord {
  return {
    amount: row.amount,
    convertedExpenseId: row.converted_expense_id,
    createdAt: row.created_at,
    currencyCode: row.currency_code.trim(),
    id: row.id,
    paidDate: dateOnly(row.paid_date),
    scheduledDate: dateOnly(row.scheduled_date),
    subscriptionId: row.subscription_id,
    subscriptionName: row.subscription_name,
  };
}

export function subscriptionCursorValue(
  subscription: SubscriptionRecord,
  sort: SubscriptionSort,
): string {
  switch (sort) {
    case 'amount_desc':
      return subscription.amount;
    case 'updated_desc':
      return subscription.updatedAt.toISOString();
    case 'next_asc':
    case 'next_desc':
      return subscription.nextPaymentDate;
  }
}

export interface SubscriptionStore {
  changeStatus(input: {
    action: 'cancel' | 'pause' | 'resume';
    now: Date;
    ownerId: string;
    sessionId: string;
    subscriptionId: string;
  }): Promise<boolean>;
  convertPayment(input: ConvertPaymentStoreInput): Promise<{
    expenseId: string;
    mismatched: boolean;
    replayed: boolean;
  }>;
  createSubscription(input: CreateSubscriptionStoreInput): Promise<boolean>;
  deleteSubscription(input: {
    now: Date;
    ownerId: string;
    sessionId: string;
    subscriptionId: string;
  }): Promise<boolean>;
  dismissReminder(
    ownerId: string,
    reminderId: string,
    now: Date,
  ): Promise<boolean>;
  getPayment(
    ownerId: string,
    paymentId: string,
  ): Promise<SubscriptionPaymentRecord | null>;
  getSubscription(
    ownerId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord | null>;
  getTimeZone(ownerId: string): Promise<string>;
  listPayments(
    ownerId: string,
    subscriptionId: string,
    cursor: SubscriptionCursor | undefined,
    limit: number,
  ): Promise<SubscriptionPaymentPage>;
  listReminders(ownerId: string): Promise<SubscriptionReminder[]>;
  listSubscriptions(
    ownerId: string,
    filters: SubscriptionFilters,
  ): Promise<SubscriptionPage>;
  listUpcoming(
    ownerId: string,
    today: string,
    throughDate: string,
    limit: number,
  ): Promise<SubscriptionUpcomingResponse>;
  recordPayment(input: RecordPaymentStoreInput): Promise<{
    mismatched: boolean;
    paymentId: string;
    replayed: boolean;
  }>;
  updateSubscription(input: UpdateSubscriptionStoreInput): Promise<boolean>;
}

export class PostgresSubscriptionStore implements SubscriptionStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getTimeZone(ownerId: string): Promise<string> {
    const settings = await this.database
      .selectFrom('app_settings')
      .select('time_zone')
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    return settings.time_zone;
  }

  async listSubscriptions(
    ownerId: string,
    filters: SubscriptionFilters,
  ): Promise<SubscriptionPage> {
    const conditions = [
      sql<boolean>`s.owner_id = ${ownerId}::uuid`,
      sql<boolean>`s.deleted_at is null`,
    ];
    if (filters.categoryId) {
      conditions.push(
        sql<boolean>`s.category_id = ${filters.categoryId}::uuid`,
      );
    }
    if (filters.status) {
      conditions.push(sql<boolean>`s.status = ${filters.status}`);
    }
    if (filters.dateFrom) {
      conditions.push(
        sql<boolean>`s.next_payment_date >= ${filters.dateFrom}::date`,
      );
    }
    if (filters.dateTo) {
      conditions.push(
        sql<boolean>`s.next_payment_date <= ${filters.dateTo}::date`,
      );
    }
    if (filters.search) {
      conditions.push(
        sql<boolean>`s.search_vector @@ websearch_to_tsquery('simple', ${filters.search})`,
      );
    }
    if (filters.cursor) {
      const cursor = filters.cursor;
      switch (filters.sort) {
        case 'next_asc':
          conditions.push(sql<boolean>`(
            s.next_payment_date > ${cursor.value}::date
            or (
              s.next_payment_date = ${cursor.value}::date
              and s.id > ${cursor.id}::uuid
            )
          )`);
          break;
        case 'next_desc':
          conditions.push(sql<boolean>`(
            s.next_payment_date < ${cursor.value}::date
            or (
              s.next_payment_date = ${cursor.value}::date
              and s.id < ${cursor.id}::uuid
            )
          )`);
          break;
        case 'amount_desc':
          conditions.push(sql<boolean>`(
            s.amount < ${cursor.value}::numeric
            or (s.amount = ${cursor.value}::numeric and s.id < ${cursor.id}::uuid)
          )`);
          break;
        case 'updated_desc':
          conditions.push(sql<boolean>`(
            s.updated_at < ${cursor.value}::timestamptz
            or (
              s.updated_at = ${cursor.value}::timestamptz
              and s.id < ${cursor.id}::uuid
            )
          )`);
          break;
      }
    }

    let orderBy = sql`s.next_payment_date asc, s.id asc`;
    switch (filters.sort) {
      case 'next_desc':
        orderBy = sql`s.next_payment_date desc, s.id desc`;
        break;
      case 'amount_desc':
        orderBy = sql`s.amount desc, s.id desc`;
        break;
      case 'updated_desc':
        orderBy = sql`s.updated_at desc, s.id desc`;
        break;
      case 'next_asc':
        break;
    }

    const result = await sql<SubscriptionRow>`
      select
        s.id,
        s.name,
        s.amount::text as amount,
        s.currency_code,
        s.billing_frequency,
        s.custom_interval_days,
        s.next_payment_date,
        s.auto_renew,
        s.reminder_days,
        s.status,
        s.start_date,
        s.end_date,
        s.notes,
        s.created_at,
        s.updated_at,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = s.owner_id
            and ea.entity_type = 'subscription'
            and ea.entity_id = s.id
        ) as attachment_count,
        c.id as category_id,
        c.name as category_name,
        c.icon as category_icon,
        c.color as category_color,
        c.is_archived as category_archived
      from subscriptions s
      inner join categories c
        on c.owner_id = s.owner_id
        and c.id = s.category_id
      where ${sql.join(conditions, sql` and `)}
      order by ${orderBy}
      limit ${filters.limit + 1}
    `.execute(this.database);
    return {
      hasMore: result.rows.length > filters.limit,
      items: result.rows.slice(0, filters.limit).map(mapSubscription),
    };
  }

  async getSubscription(
    ownerId: string,
    subscriptionId: string,
  ): Promise<SubscriptionRecord | null> {
    const result = await sql<SubscriptionRow>`
      select
        s.id,
        s.name,
        s.amount::text as amount,
        s.currency_code,
        s.billing_frequency,
        s.custom_interval_days,
        s.next_payment_date,
        s.auto_renew,
        s.reminder_days,
        s.status,
        s.start_date,
        s.end_date,
        s.notes,
        s.created_at,
        s.updated_at,
        (
          select count(*)::integer
          from entity_attachments ea
          inner join attachments a
            on a.owner_id = ea.owner_id
            and a.id = ea.attachment_id
            and a.deleted_at is null
          where ea.owner_id = s.owner_id
            and ea.entity_type = 'subscription'
            and ea.entity_id = s.id
        ) as attachment_count,
        c.id as category_id,
        c.name as category_name,
        c.icon as category_icon,
        c.color as category_color,
        c.is_archived as category_archived
      from subscriptions s
      inner join categories c
        on c.owner_id = s.owner_id
        and c.id = s.category_id
      where s.owner_id = ${ownerId}::uuid
        and s.id = ${subscriptionId}::uuid
        and s.deleted_at is null
      limit 1
    `.execute(this.database);
    const row = result.rows[0];
    return row ? mapSubscription(row) : null;
  }

  async createSubscription(
    input: CreateSubscriptionStoreInput,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const [category, settings] = await Promise.all([
        transaction
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.categoryId)
          .where('is_archived', '=', false)
          .executeTakeFirst(),
        transaction
          .selectFrom('app_settings')
          .select('default_currency')
          .where('owner_id', '=', input.ownerId)
          .executeTakeFirstOrThrow(),
      ]);
      if (!category) return false;

      await transaction
        .insertInto('subscriptions')
        .values({
          amount: input.amount,
          auto_renew: input.autoRenew,
          billing_frequency: input.billingFrequency,
          category_id: input.categoryId,
          currency_code: settings.default_currency,
          custom_interval_days: input.customIntervalDays,
          end_date: input.endDate,
          id: input.subscriptionId,
          name: input.name,
          next_payment_date: input.nextPaymentDate,
          notes: input.notes,
          owner_id: input.ownerId,
          reminder_days: input.reminderDays,
          start_date: input.startDate,
        })
        .executeTakeFirstOrThrow();
      await this.scheduleReminder(transaction, {
        ownerId: input.ownerId,
        paymentDate: input.nextPaymentDate,
        reminderDays: input.reminderDays,
        subscriptionId: input.subscriptionId,
      });
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'subscription.created',
          id: randomUUID(),
          metadata: { subscriptionId: input.subscriptionId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async updateSubscription(
    input: UpdateSubscriptionStoreInput,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const [existing, category] = await Promise.all([
        transaction
          .selectFrom('subscriptions')
          .select(['id', 'status'])
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.subscriptionId)
          .where('deleted_at', 'is', null)
          .forUpdate()
          .executeTakeFirst(),
        transaction
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.categoryId)
          .executeTakeFirst(),
      ]);
      if (!existing || !category) return false;

      await transaction
        .updateTable('subscriptions')
        .set({
          amount: input.amount,
          auto_renew: input.autoRenew,
          billing_frequency: input.billingFrequency,
          category_id: input.categoryId,
          custom_interval_days: input.customIntervalDays,
          end_date: input.endDate,
          name: input.name,
          next_payment_date: input.nextPaymentDate,
          notes: input.notes,
          reminder_days: input.reminderDays,
          start_date: input.startDate,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('subscription_reminders')
        .set({ status: 'completed', updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('subscription_id', '=', input.subscriptionId)
        .where('status', 'in', ['pending', 'ready'])
        .execute();
      if (existing.status === 'active') {
        await this.scheduleReminder(transaction, {
          ownerId: input.ownerId,
          paymentDate: input.nextPaymentDate,
          reminderDays: input.reminderDays,
          subscriptionId: input.subscriptionId,
        });
      }
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'subscription.updated',
          id: randomUUID(),
          metadata: { subscriptionId: input.subscriptionId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async changeStatus(input: {
    action: 'cancel' | 'pause' | 'resume';
    now: Date;
    ownerId: string;
    sessionId: string;
    subscriptionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const subscription = await transaction
        .selectFrom('subscriptions')
        .select(['next_payment_date', 'reminder_days', 'status'])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!subscription) return false;
      const valid =
        (input.action === 'pause' && subscription.status === 'active') ||
        (input.action === 'resume' && subscription.status === 'paused') ||
        (input.action === 'cancel' &&
          ['active', 'paused'].includes(subscription.status));
      if (!valid) return false;
      const status =
        input.action === 'pause'
          ? 'paused'
          : input.action === 'resume'
            ? 'active'
            : 'cancelled';
      await transaction
        .updateTable('subscriptions')
        .set({ status, updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('subscription_reminders')
        .set({ status: 'completed', updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('subscription_id', '=', input.subscriptionId)
        .where('status', 'in', ['pending', 'ready'])
        .execute();
      if (status === 'active') {
        await this.scheduleReminder(transaction, {
          ownerId: input.ownerId,
          paymentDate: dateOnly(subscription.next_payment_date),
          reminderDays: subscription.reminder_days,
          subscriptionId: input.subscriptionId,
        });
      }
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: `subscription.${input.action === 'cancel' ? 'cancelled' : `${input.action}d`}`,
          id: randomUUID(),
          metadata: { subscriptionId: input.subscriptionId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async deleteSubscription(input: {
    now: Date;
    ownerId: string;
    sessionId: string;
    subscriptionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const attachments = await transaction
        .selectFrom('attachments as attachment')
        .innerJoin('entity_attachments as link', (join) =>
          join
            .onRef('link.owner_id', '=', 'attachment.owner_id')
            .onRef('link.attachment_id', '=', 'attachment.id')
            .on('link.entity_type', '=', 'subscription')
            .on('link.entity_id', '=', input.subscriptionId),
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
        .updateTable('subscriptions')
        .set({
          deleted_at: input.now,
          status: 'cancelled',
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) return false;
      await transaction
        .updateTable('subscription_reminders')
        .set({ status: 'completed', updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('subscription_id', '=', input.subscriptionId)
        .where('status', 'in', ['pending', 'ready'])
        .execute();
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
        .where('entity_type', '=', 'subscription')
        .where('entity_id', '=', input.subscriptionId)
        .execute();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'subscription.deleted',
          id: randomUUID(),
          metadata: { subscriptionId: input.subscriptionId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async recordPayment(input: RecordPaymentStoreInput): Promise<{
    mismatched: boolean;
    paymentId: string;
    replayed: boolean;
  }> {
    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('subscription_payment_requests')
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
          .selectFrom('subscription_payment_requests')
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

      const subscription = await transaction
        .selectFrom('subscriptions')
        .select([
          'amount',
          'auto_renew',
          'billing_frequency',
          'currency_code',
          'custom_interval_days',
          'end_date',
          'next_payment_date',
          'reminder_days',
          'status',
        ])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
      if (subscription.status !== 'active') {
        throw new Error('SUBSCRIPTION_PAYMENT_STATUS_INVALID');
      }
      const scheduledDate = dateOnly(subscription.next_payment_date);
      const nextPaymentDate = nextBillingDate(
        scheduledDate,
        subscription.billing_frequency,
        subscription.custom_interval_days,
      );
      const endDate = nullableDateOnly(subscription.end_date);
      const remainsActive =
        subscription.auto_renew &&
        (endDate === null || nextPaymentDate <= endDate);

      await transaction
        .insertInto('subscription_payments')
        .values({
          amount: input.amount ?? subscription.amount,
          converted_expense_id: null,
          currency_code: subscription.currency_code,
          id: input.paymentId,
          owner_id: input.ownerId,
          paid_date: input.paidDate,
          scheduled_date: scheduledDate,
          subscription_id: input.subscriptionId,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('subscriptions')
        .set({
          next_payment_date: nextPaymentDate,
          status: remainsActive ? 'active' : 'ended',
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.subscriptionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('subscription_reminders')
        .set({ status: 'completed', updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('subscription_id', '=', input.subscriptionId)
        .where('payment_date', '=', scheduledDate)
        .where('status', 'in', ['pending', 'ready'])
        .execute();
      if (remainsActive) {
        await this.scheduleReminder(transaction, {
          ownerId: input.ownerId,
          paymentDate: nextPaymentDate,
          reminderDays: subscription.reminder_days,
          subscriptionId: input.subscriptionId,
        });
      }
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'subscription.payment_recorded',
          id: randomUUID(),
          metadata: {
            paymentId: input.paymentId,
            subscriptionId: input.subscriptionId,
          },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return {
        mismatched: false,
        paymentId: input.paymentId,
        replayed: false,
      };
    });
  }

  async convertPayment(input: ConvertPaymentStoreInput): Promise<{
    expenseId: string;
    mismatched: boolean;
    replayed: boolean;
  }> {
    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('subscription_conversion_requests')
        .values({
          expense_id: input.expenseId,
          idempotency_key: input.idempotencyKey,
          owner_id: input.ownerId,
          payment_id: input.paymentId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('expense_id')
        .executeTakeFirst();
      if (!request) {
        const existing = await transaction
          .selectFrom('subscription_conversion_requests')
          .select(['expense_id', 'request_hash'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirstOrThrow();
        return {
          expenseId: existing.expense_id,
          mismatched: existing.request_hash.trim() !== input.requestHash,
          replayed: existing.request_hash.trim() === input.requestHash,
        };
      }

      const [payment, paymentMethod] = await Promise.all([
        transaction
          .selectFrom('subscription_payments as payment')
          .innerJoin('subscriptions as subscription', (join) =>
            join
              .onRef('subscription.owner_id', '=', 'payment.owner_id')
              .onRef('subscription.id', '=', 'payment.subscription_id'),
          )
          .select([
            'payment.amount',
            'payment.converted_expense_id',
            'payment.currency_code',
            'payment.paid_date',
            'payment.scheduled_date',
            'subscription.category_id',
            'subscription.name',
            'subscription.id as subscription_id',
          ])
          .where('payment.owner_id', '=', input.ownerId)
          .where('payment.id', '=', input.paymentId)
          .forUpdate()
          .executeTakeFirst(),
        transaction
          .selectFrom('payment_methods')
          .select('id')
          .where('owner_id', '=', input.ownerId)
          .where('id', '=', input.paymentMethodId)
          .where('is_archived', '=', false)
          .executeTakeFirst(),
      ]);
      if (!payment) throw new Error('SUBSCRIPTION_PAYMENT_NOT_FOUND');
      if (payment.converted_expense_id) {
        throw new Error('SUBSCRIPTION_PAYMENT_ALREADY_CONVERTED');
      }
      if (!paymentMethod) throw new Error('PAYMENT_METHOD_NOT_FOUND');
      const scheduledDate = dateOnly(payment.scheduled_date);

      await transaction
        .insertInto('expenses')
        .values({
          amount: payment.amount,
          category_id: payment.category_id,
          currency_code: payment.currency_code,
          description: payment.name,
          expense_date: dateOnly(payment.paid_date),
          id: input.expenseId,
          merchant: payment.name,
          notes: `Created from the subscription payment due ${scheduledDate}.`,
          owner_id: input.ownerId,
          payment_method_id: input.paymentMethodId,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('subscription_payments')
        .set({
          converted_expense_id: input.expenseId,
          updated_at: input.now,
        })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.paymentId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values([
          {
            actor_session_id: input.sessionId,
            event_type: 'expense.created',
            id: randomUUID(),
            metadata: {
              expenseId: input.expenseId,
              source: 'subscription_payment',
            },
            owner_id: input.ownerId,
          },
          {
            actor_session_id: input.sessionId,
            event_type: 'subscription.payment_converted',
            id: randomUUID(),
            metadata: {
              expenseId: input.expenseId,
              paymentId: input.paymentId,
              subscriptionId: payment.subscription_id,
            },
            owner_id: input.ownerId,
          },
        ])
        .execute();
      return {
        expenseId: input.expenseId,
        mismatched: false,
        replayed: false,
      };
    });
  }

  async listPayments(
    ownerId: string,
    subscriptionId: string,
    cursor: SubscriptionCursor | undefined,
    limit: number,
  ): Promise<SubscriptionPaymentPage> {
    const cursorCondition = cursor
      ? sql<boolean>`and (
          p.paid_date < ${cursor.value}::date
          or (p.paid_date = ${cursor.value}::date and p.id < ${cursor.id}::uuid)
        )`
      : sql<boolean>``;
    const result = await sql<PaymentRow>`
      select
        p.id,
        p.subscription_id,
        s.name as subscription_name,
        p.scheduled_date,
        p.paid_date,
        p.amount::text as amount,
        p.currency_code,
        p.converted_expense_id,
        p.created_at
      from subscription_payments p
      inner join subscriptions s
        on s.owner_id = p.owner_id
        and s.id = p.subscription_id
      where p.owner_id = ${ownerId}::uuid
        and p.subscription_id = ${subscriptionId}::uuid
        ${cursorCondition}
      order by p.paid_date desc, p.id desc
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
  ): Promise<SubscriptionPaymentRecord | null> {
    const result = await sql<PaymentRow>`
      select
        p.id,
        p.subscription_id,
        s.name as subscription_name,
        p.scheduled_date,
        p.paid_date,
        p.amount::text as amount,
        p.currency_code,
        p.converted_expense_id,
        p.created_at
      from subscription_payments p
      inner join subscriptions s
        on s.owner_id = p.owner_id
        and s.id = p.subscription_id
      where p.owner_id = ${ownerId}::uuid
        and p.id = ${paymentId}::uuid
      limit 1
    `.execute(this.database);
    const row = result.rows[0];
    return row ? mapPayment(row) : null;
  }

  async listUpcoming(
    ownerId: string,
    today: string,
    throughDate: string,
    limit: number,
  ): Promise<SubscriptionUpcomingResponse> {
    const result = await sql<{
      amount: string;
      currency_code: string;
      days_until_due: number;
      due_soon_count: string;
      id: string;
      name: string;
      next_payment_date: Date | string;
      overdue_count: string;
    }>`
      select
        s.id,
        s.name,
        s.amount::text as amount,
        s.currency_code,
        s.next_payment_date,
        (s.next_payment_date - ${today}::date)::integer as days_until_due,
        count(*) over ()::text as due_soon_count,
        count(*) filter (
          where s.next_payment_date < ${today}::date
        ) over ()::text as overdue_count
      from subscriptions s
      where s.owner_id = ${ownerId}::uuid
        and s.deleted_at is null
        and s.status = 'active'
        and s.next_payment_date <= ${throughDate}::date
      order by s.next_payment_date asc, s.id asc
      limit ${limit}
    `.execute(this.database);
    const counts = result.rows[0];
    return {
      dueSoonCount: Number(counts?.due_soon_count ?? 0),
      items: result.rows.map((row) => ({
        amount: row.amount,
        currencyCode: row.currency_code.trim(),
        daysUntilDue: Number(row.days_until_due),
        id: row.id,
        name: row.name,
        nextPaymentDate: dateOnly(row.next_payment_date),
        overdue: Number(row.days_until_due) < 0,
      })),
      overdueCount: Number(counts?.overdue_count ?? 0),
    };
  }

  async listReminders(ownerId: string): Promise<SubscriptionReminder[]> {
    const result = await sql<{
      amount: string;
      currency_code: string;
      id: string;
      name: string;
      payment_date: Date | string;
      subscription_id: string;
    }>`
      select
        r.id,
        r.subscription_id,
        s.name,
        s.amount::text as amount,
        s.currency_code,
        r.payment_date
      from subscription_reminders r
      inner join subscriptions s
        on s.owner_id = r.owner_id
        and s.id = r.subscription_id
      where r.owner_id = ${ownerId}::uuid
        and r.status = 'ready'
        and s.deleted_at is null
        and s.status = 'active'
        and s.next_payment_date = r.payment_date
      order by r.payment_date asc, r.id asc
      limit 50
    `.execute(this.database);
    return result.rows.map((row) => ({
      amount: row.amount,
      currencyCode: row.currency_code.trim(),
      id: row.id,
      name: row.name,
      paymentDate: dateOnly(row.payment_date),
      subscriptionId: row.subscription_id,
    }));
  }

  async dismissReminder(
    ownerId: string,
    reminderId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.database
      .updateTable('subscription_reminders')
      .set({
        dismissed_at: now,
        status: 'dismissed',
        updated_at: now,
      })
      .where('owner_id', '=', ownerId)
      .where('id', '=', reminderId)
      .where('status', '=', 'ready')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  private async scheduleReminder(
    transaction: Transaction<DatabaseSchema>,
    input: {
      ownerId: string;
      paymentDate: string;
      reminderDays: number;
      subscriptionId: string;
    },
  ): Promise<void> {
    await transaction
      .insertInto('subscription_reminders')
      .values({
        dismissed_at: null,
        id: randomUUID(),
        owner_id: input.ownerId,
        payment_date: input.paymentDate,
        ready_at: null,
        remind_on: reminderDate(input.paymentDate, input.reminderDays),
        status: 'pending',
        subscription_id: input.subscriptionId,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['owner_id', 'subscription_id', 'payment_date'])
          .doUpdateSet({
            dismissed_at: null,
            ready_at: null,
            remind_on: reminderDate(input.paymentDate, input.reminderDays),
            status: 'pending',
            updated_at: new Date(),
          }),
      )
      .executeTakeFirstOrThrow();
  }
}

export type {
  ConvertPaymentStoreInput,
  CreateSubscriptionStoreInput,
  RecordPaymentStoreInput,
  UpdateSubscriptionStoreInput,
};
