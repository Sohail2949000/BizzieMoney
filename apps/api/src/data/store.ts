import { randomUUID } from 'node:crypto';

import {
  sql,
  type BizzieMoneyDatabase,
  type DatabaseSchema,
  type Transaction,
} from '@bizziemoney/database';

import { AppError } from '../errors.js';
import {
  type DataStore,
  type FinancialPurgeCounts,
  type FinancialPurgeResult,
  type PortableRecord,
  type PortableSnapshotResult,
  type PortableSnapshotWriters,
  type PurgeStoreInput,
} from './types.js';

interface JsonRow {
  data: Record<string, unknown>;
}

interface AttachmentRow extends JsonRow {
  checksum_sha256: string;
  id: string;
  mime_type: string;
  object_key: string;
  size_bytes: string;
  storage_provider: 'local' | 's3';
  storage_root: string;
}

const imageExtensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function camelCase(key: string): string {
  return key.replaceAll(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function camelRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [camelCase(key), entry]),
  );
}

function storedPurgeResult(
  value: Record<string, unknown>,
  replayed: boolean,
): FinancialPurgeResult {
  return {
    attachmentFilesQueued: Number(value.attachmentFilesQueued ?? 0),
    attachments: Number(value.attachments ?? 0),
    completedAt: String(value.completedAt),
    debtPayments: Number(value.debtPayments ?? 0),
    debts: Number(value.debts ?? 0),
    expenses: Number(value.expenses ?? 0),
    replayed,
    subscriptionPayments: Number(value.subscriptionPayments ?? 0),
    subscriptions: Number(value.subscriptions ?? 0),
    tags: Number(value.tags ?? 0),
  };
}

async function deleteOwnerRows(
  transaction: Transaction<DatabaseSchema>,
  table:
    | 'attachment_upload_requests'
    | 'attachments'
    | 'debt_payment_requests'
    | 'debt_payments'
    | 'debts'
    | 'entity_attachments'
    | 'expense_creation_requests'
    | 'expense_import_requests'
    | 'expense_tags'
    | 'expenses'
    | 'subscription_conversion_requests'
    | 'subscription_payment_requests'
    | 'subscription_payments'
    | 'subscription_reminders'
    | 'subscriptions'
    | 'tags',
  ownerId: string,
): Promise<void> {
  await transaction.deleteFrom(table).where('owner_id', '=', ownerId).execute();
}

export class PostgresDataStore implements DataStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async writePortableSnapshot(
    ownerId: string,
    writers: PortableSnapshotWriters,
  ): Promise<PortableSnapshotResult> {
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (transaction) => {
        const meta = await transaction
          .selectFrom('app_meta')
          .select(['application_version', 'schema_version'])
          .where('id', '=', 1)
          .executeTakeFirstOrThrow();
        const recordCounts: Record<string, number> = {};
        const writeRows = async (
          type: string,
          query: Promise<{ rows: JsonRow[] }>,
        ): Promise<void> => {
          const result = await query;
          recordCounts[type] = result.rows.length;
          for (const row of result.rows) {
            const record: PortableRecord = {
              data: camelRecord(row.data),
              type,
            };
            await writers.writeRecord(record);
          }
        };

        await writeRows(
          'owner',
          sql<JsonRow>`
            select to_jsonb(owner_record) as data
            from (
              select id, email, display_name, created_at, updated_at
              from app_users
              where id = ${ownerId}
            ) owner_record
          `.execute(transaction),
        );
        await writeRows(
          'preferences',
          sql<JsonRow>`
            select to_jsonb(settings_record) as data
            from (
              select
                default_currency,
                date_format,
                number_format,
                first_day_of_week,
                time_zone,
                created_at,
                updated_at
              from app_settings
              where owner_id = ${ownerId}
            ) settings_record
          `.execute(transaction),
        );
        await writeRows(
          'category',
          sql<JsonRow>`
            select to_jsonb(category_record) as data
            from (
              select id, name, icon, color, is_archived, created_at, updated_at
              from categories
              where owner_id = ${ownerId}
              order by id
            ) category_record
          `.execute(transaction),
        );
        await writeRows(
          'paymentMethod',
          sql<JsonRow>`
            select to_jsonb(method_record) as data
            from (
              select id, name, icon, is_archived, created_at, updated_at
              from payment_methods
              where owner_id = ${ownerId}
              order by id
            ) method_record
          `.execute(transaction),
        );
        await writeRows(
          'tag',
          sql<JsonRow>`
            select to_jsonb(tag_record) as data
            from (
              select id, name, created_at
              from tags
              where owner_id = ${ownerId}
              order by id
            ) tag_record
          `.execute(transaction),
        );
        await writeRows(
          'expense',
          sql<JsonRow>`
            select to_jsonb(expense_record) as data
            from (
              select
                id,
                expense_date,
                description,
                amount::text as amount,
                currency_code,
                category_id,
                payment_method_id,
                merchant,
                notes,
                created_at,
                updated_at
              from expenses
              where owner_id = ${ownerId} and deleted_at is null
              order by id
            ) expense_record
          `.execute(transaction),
        );
        await writeRows(
          'expenseTag',
          sql<JsonRow>`
            select to_jsonb(link_record) as data
            from (
              select link.expense_id, link.tag_id, link.created_at
              from expense_tags link
              join expenses expense
                on expense.owner_id = link.owner_id
                and expense.id = link.expense_id
                and expense.deleted_at is null
              where link.owner_id = ${ownerId}
              order by link.expense_id, link.tag_id
            ) link_record
          `.execute(transaction),
        );
        await writeRows(
          'subscription',
          sql<JsonRow>`
            select to_jsonb(subscription_record) as data
            from (
              select
                id,
                name,
                amount::text as amount,
                currency_code,
                billing_frequency,
                custom_interval_days,
                next_payment_date,
                category_id,
                auto_renew,
                reminder_days,
                status,
                start_date,
                end_date,
                notes,
                created_at,
                updated_at
              from subscriptions
              where owner_id = ${ownerId} and deleted_at is null
              order by id
            ) subscription_record
          `.execute(transaction),
        );
        await writeRows(
          'subscriptionPayment',
          sql<JsonRow>`
            select to_jsonb(payment_record) as data
            from (
              select
                payment.id,
                payment.subscription_id,
                payment.scheduled_date,
                payment.paid_date,
                payment.amount::text as amount,
                payment.currency_code,
                payment.converted_expense_id,
                payment.created_at,
                payment.updated_at
              from subscription_payments payment
              join subscriptions subscription
                on subscription.owner_id = payment.owner_id
                and subscription.id = payment.subscription_id
                and subscription.deleted_at is null
              where payment.owner_id = ${ownerId}
              order by payment.id
            ) payment_record
          `.execute(transaction),
        );
        await writeRows(
          'subscriptionReminder',
          sql<JsonRow>`
            select to_jsonb(reminder_record) as data
            from (
              select
                reminder.id,
                reminder.subscription_id,
                reminder.payment_date,
                reminder.remind_on,
                reminder.status,
                reminder.ready_at,
                reminder.dismissed_at,
                reminder.created_at,
                reminder.updated_at
              from subscription_reminders reminder
              join subscriptions subscription
                on subscription.owner_id = reminder.owner_id
                and subscription.id = reminder.subscription_id
                and subscription.deleted_at is null
              where reminder.owner_id = ${ownerId}
              order by reminder.id
            ) reminder_record
          `.execute(transaction),
        );
        await writeRows(
          'debt',
          sql<JsonRow>`
            select to_jsonb(debt_record) as data
            from (
              select
                id,
                direction,
                name,
                original_amount::text as original_amount,
                currency_code,
                start_date,
                due_date,
                installment_amount::text as installment_amount,
                installment_frequency,
                custom_interval_days,
                next_payment_date,
                interest_note,
                status,
                notes,
                completed_at,
                created_at,
                updated_at
              from debts
              where owner_id = ${ownerId} and deleted_at is null
              order by id
            ) debt_record
          `.execute(transaction),
        );
        await writeRows(
          'debtPayment',
          sql<JsonRow>`
            select to_jsonb(payment_record) as data
            from (
              select
                payment.id,
                payment.debt_id,
                payment.payment_date,
                payment.amount::text as amount,
                payment.notes,
                payment.created_at,
                payment.updated_at
              from debt_payments payment
              join debts debt
                on debt.owner_id = payment.owner_id
                and debt.id = payment.debt_id
                and debt.deleted_at is null
              where payment.owner_id = ${ownerId}
                and payment.deleted_at is null
              order by payment.id
            ) payment_record
          `.execute(transaction),
        );

        const attachmentResult = await sql<AttachmentRow>`
          select
            attachment.id,
            attachment.storage_provider,
            attachment.storage_root,
            attachment.object_key,
            attachment.mime_type,
            attachment.size_bytes::text,
            attachment.checksum_sha256,
            to_jsonb(attachment_record) as data
          from attachments attachment
          cross join lateral (
            select
              attachment.id,
              attachment.original_file_name,
              attachment.display_name,
              attachment.mime_type,
              attachment.size_bytes::text as size_bytes,
              attachment.checksum_sha256,
              attachment.created_at,
              attachment.updated_at
          ) attachment_record
          where attachment.owner_id = ${ownerId}
            and attachment.deleted_at is null
          order by attachment.id
        `.execute(transaction);
        recordCounts.attachment = attachmentResult.rows.length;
        for (const row of attachmentResult.rows) {
          const extension = imageExtensions[row.mime_type] ?? '';
          const archivePath = `attachments/${row.id}/original${extension}`;
          await writers.writeRecord({
            data: {
              ...camelRecord(row.data),
              archivePath,
            },
            type: 'attachment',
          });
          await writers.writeAttachment({
            archivePath,
            checksumSha256: row.checksum_sha256,
            id: row.id,
            objectKey: row.object_key,
            sizeBytes: Number(row.size_bytes),
            storageProvider: row.storage_provider,
            storageRoot: row.storage_root,
          });
        }

        await writeRows(
          'entityAttachment',
          sql<JsonRow>`
            select to_jsonb(link_record) as data
            from (
              select
                link.attachment_id,
                link.entity_type,
                link.entity_id,
                link.created_at
              from entity_attachments link
              join attachments attachment
                on attachment.owner_id = link.owner_id
                and attachment.id = link.attachment_id
                and attachment.deleted_at is null
              where link.owner_id = ${ownerId}
                and (
                  (
                    link.entity_type = 'expense'
                    and exists (
                      select 1 from expenses
                      where owner_id = link.owner_id
                        and id = link.entity_id
                        and deleted_at is null
                    )
                  )
                  or (
                    link.entity_type = 'subscription'
                    and exists (
                      select 1 from subscriptions
                      where owner_id = link.owner_id
                        and id = link.entity_id
                        and deleted_at is null
                    )
                  )
                  or (
                    link.entity_type = 'debt'
                    and exists (
                      select 1 from debts
                      where owner_id = link.owner_id
                        and id = link.entity_id
                        and deleted_at is null
                    )
                  )
                  or (
                    link.entity_type = 'debt_payment'
                    and exists (
                      select 1 from debt_payments
                      where owner_id = link.owner_id
                        and id = link.entity_id
                        and deleted_at is null
                    )
                  )
                )
              order by link.entity_type, link.entity_id, link.attachment_id
            ) link_record
          `.execute(transaction),
        );

        return {
          applicationVersion: meta.application_version,
          attachmentCount: attachmentResult.rows.length,
          recordCounts,
          schemaVersion: meta.schema_version,
        };
      });
  }

  async purgeFinancialData(
    input: PurgeStoreInput,
  ): Promise<FinancialPurgeResult> {
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto('financial_purge_requests')
        .values({
          idempotency_key: input.idempotencyKey,
          owner_id: input.ownerId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('idempotency_key')
        .executeTakeFirst();

      if (!inserted) {
        const existing = await transaction
          .selectFrom('financial_purge_requests')
          .select(['request_hash', 'result'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (existing.request_hash !== input.requestHash) {
          throw new AppError({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Use a new request key for this deletion.',
            statusCode: 409,
          });
        }
        if (existing.result) {
          return storedPurgeResult(existing.result, true);
        }
        throw new AppError({
          code: 'PURGE_ALREADY_RUNNING',
          message: 'This deletion request is already being processed.',
          statusCode: 409,
        });
      }

      await transaction
        .selectFrom('app_users')
        .select('id')
        .where('id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const activeJob = await transaction
        .selectFrom('backup_jobs')
        .select('id')
        .where('owner_id', '=', input.ownerId)
        .where('status', 'in', ['queued', 'processing'])
        .forUpdate()
        .executeTakeFirst();
      if (activeJob) {
        throw new AppError({
          code: 'DATA_OPERATION_ACTIVE',
          message:
            'Wait for the active backup or restore operation to finish before deleting data.',
          statusCode: 409,
        });
      }

      const countResult = await sql<FinancialPurgeCounts>`
        select
          (select count(*)::integer from expenses where owner_id = ${input.ownerId}) as expenses,
          (select count(*)::integer from subscriptions where owner_id = ${input.ownerId}) as subscriptions,
          (select count(*)::integer from subscription_payments where owner_id = ${input.ownerId}) as "subscriptionPayments",
          (select count(*)::integer from debts where owner_id = ${input.ownerId}) as debts,
          (select count(*)::integer from debt_payments where owner_id = ${input.ownerId}) as "debtPayments",
          (select count(*)::integer from attachments where owner_id = ${input.ownerId}) as attachments,
          (select count(*)::integer from tags where owner_id = ${input.ownerId}) as tags,
          0::integer as "attachmentFilesQueued"
      `.execute(transaction);
      const counts = countResult.rows[0]!;

      const cleanupResult = await sql<{ count: number }>`
        with attachment_objects as (
          select
            attachment.id as attachment_id,
            attachment.storage_provider,
            attachment.storage_root,
            attachment.object_key
          from attachments attachment
          where attachment.owner_id = ${input.ownerId}

          union all

          select
            attachment.id,
            attachment.storage_provider,
            attachment.storage_root,
            attachment.object_key || '.thumb.webp'
          from attachments attachment
          where attachment.owner_id = ${input.ownerId}
            and attachment.mime_type in ('image/jpeg', 'image/png', 'image/webp')
        ),
        queued as (
          insert into attachment_cleanup_jobs (
            id,
            owner_id,
            attachment_id,
            storage_provider,
            storage_root,
            object_key,
            status,
            scheduled_at,
            created_at,
            updated_at
          )
          select
            gen_random_uuid(),
            ${input.ownerId},
            object.attachment_id,
            object.storage_provider,
            object.storage_root,
            object.object_key,
            'pending',
            ${input.now},
            ${input.now},
            ${input.now}
          from attachment_objects object
          where not exists (
            select 1
            from attachment_cleanup_jobs existing
            where existing.owner_id = ${input.ownerId}
              and existing.storage_provider = object.storage_provider
              and existing.storage_root = object.storage_root
              and existing.object_key = object.object_key
              and existing.status in ('pending', 'processing', 'completed')
          )
          returning 1
        )
        select count(*)::integer as count from queued
      `.execute(transaction);
      counts.attachmentFilesQueued = cleanupResult.rows[0]?.count ?? 0;

      const deletionOrder = [
        'entity_attachments',
        'attachment_upload_requests',
        'subscription_conversion_requests',
        'subscription_payment_requests',
        'debt_payment_requests',
        'expense_creation_requests',
        'expense_import_requests',
        'subscription_reminders',
        'subscription_payments',
        'debt_payments',
        'expense_tags',
        'attachments',
        'debts',
        'subscriptions',
        'expenses',
        'tags',
      ] as const;
      for (const table of deletionOrder) {
        await deleteOwnerRows(transaction, table, input.ownerId);
      }

      const completedAt = input.now.toISOString();
      const storedResult = { ...counts, completedAt };
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'data.financial_purged',
          id: randomUUID(),
          metadata: { ...counts },
          owner_id: input.ownerId,
        })
        .execute();
      await transaction
        .updateTable('financial_purge_requests')
        .set({
          completed_at: input.now,
          result: storedResult,
        })
        .where('owner_id', '=', input.ownerId)
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirstOrThrow();

      return { ...storedResult, replayed: false };
    });
  }
}
