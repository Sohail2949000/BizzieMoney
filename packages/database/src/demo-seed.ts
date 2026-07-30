import { randomUUID } from 'node:crypto';
import { stdout } from 'node:process';

import type { Insertable, Transaction } from 'kysely';

import { createDatabase } from './client';
import {
  buildDemoSeedPlan,
  DEMO_CATEGORY_NAMES,
  DEMO_MONTH_COUNTS,
  DEMO_PAYMENT_METHOD_NAMES,
} from './demo-data';
import type { DatabaseSchema } from './types';

const CONFIRMATION = 'SEED_PUBLIC_DEMO_DATA';
const DEFAULT_YEAR = 2026;
const MAX_BATCH_SIZE = 500;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += MAX_BATCH_SIZE) {
    result.push(values.slice(index, index + MAX_BATCH_SIZE));
  }
  return result;
}

async function insertBatches<TableName extends keyof DatabaseSchema>(
  database: Transaction<DatabaseSchema>,
  table: TableName,
  rows: ReadonlyArray<Insertable<DatabaseSchema[TableName]>>,
  conflictColumns: ReadonlyArray<keyof DatabaseSchema[TableName] & string>,
): Promise<void> {
  for (const batch of chunks(rows)) {
    await database
      .insertInto(table)
      .values(batch)
      .onConflict((conflict) => conflict.columns(conflictColumns).doNothing())
      .execute();
  }
}

function readYear(value: string | undefined): number {
  if (!value) return DEFAULT_YEAR;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('DEMO_YEAR must be an integer between 2000 and 2100.');
  }
  return year;
}

async function main(): Promise<void> {
  if (process.env.BIZZIEMONEY_DEMO_SEED_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set BIZZIEMONEY_DEMO_SEED_CONFIRM=${CONFIRMATION} to seed a disposable demo database.`,
    );
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const ownerEmail = process.env.DEMO_OWNER_EMAIL;
  if (!ownerEmail) throw new Error('DEMO_OWNER_EMAIL is required.');
  const year = readYear(process.env.DEMO_YEAR);

  const database = createDatabase({
    applicationName: 'bizziemoney-demo-seed',
    connectionString,
    maxConnections: 1,
    queryTimeoutMs: 120_000,
  });

  try {
    const metadata = await database
      .selectFrom('app_meta')
      .select(['application_version', 'schema_version'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    if (metadata.schema_version !== 16) {
      throw new Error(
        `Demo seeding requires schema version 16; found ${metadata.schema_version}.`,
      );
    }

    const owner = await database
      .selectFrom('app_users')
      .select(['display_name', 'email', 'id'])
      .where('normalized_email', '=', normalized(ownerEmail))
      .executeTakeFirst();
    if (!owner) {
      throw new Error(
        `No owner account matches DEMO_OWNER_EMAIL (${ownerEmail}).`,
      );
    }

    const result = await database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('app_settings')
        .set({ default_currency: 'USD', updated_at: new Date() })
        .where('owner_id', '=', owner.id)
        .executeTakeFirstOrThrow();

      const categories = await transaction
        .selectFrom('categories')
        .select(['id', 'name'])
        .where('owner_id', '=', owner.id)
        .where('is_archived', '=', false)
        .execute();
      const paymentMethods = await transaction
        .selectFrom('payment_methods')
        .select(['id', 'name'])
        .where('owner_id', '=', owner.id)
        .where('is_archived', '=', false)
        .execute();
      const categoryIds = Object.fromEntries(
        categories.map((category) => [category.name, category.id]),
      );
      const paymentMethodIds = Object.fromEntries(
        paymentMethods.map((method) => [method.name, method.id]),
      );

      for (const name of DEMO_CATEGORY_NAMES) {
        if (!categoryIds[name]) {
          throw new Error(`The demo owner is missing category: ${name}`);
        }
      }
      for (const name of DEMO_PAYMENT_METHOD_NAMES) {
        if (!paymentMethodIds[name]) {
          throw new Error(`The demo owner is missing payment method: ${name}`);
        }
      }

      const plan = buildDemoSeedPlan({
        categoryIds,
        ownerId: owner.id,
        paymentMethodIds,
        year,
      });

      await insertBatches(transaction, 'expenses', plan.expenses, ['id']);
      await insertBatches(transaction, 'subscriptions', plan.subscriptions, [
        'id',
      ]);
      await insertBatches(
        transaction,
        'subscription_payments',
        plan.subscriptionPayments,
        ['owner_id', 'subscription_id', 'scheduled_date'],
      );
      await insertBatches(transaction, 'debts', plan.debts, ['id']);
      await insertBatches(transaction, 'debt_payments', plan.debtPayments, [
        'id',
      ]);
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: null,
          event_type: 'demo.seeded',
          id: randomUUID(),
          metadata: {
            applicationVersion: metadata.application_version,
            debtCount: plan.debts.length,
            expenseCount: plan.expenses.length,
            months: [...DEMO_MONTH_COUNTS],
            subscriptionCount: plan.subscriptions.length,
            year,
          },
          owner_id: owner.id,
        })
        .execute();

      return {
        debtCount: plan.debts.length,
        debtPaymentCount: plan.debtPayments.length,
        expenseCount: plan.expenses.length,
        subscriptionCount: plan.subscriptions.length,
        subscriptionPaymentCount: plan.subscriptionPayments.length,
      };
    });

    stdout.write(
      [
        `Seeded BizzieMoney demo data for ${owner.email} (${owner.display_name}).`,
        `Year: ${year}`,
        `Monthly counts: ${DEMO_MONTH_COUNTS.join(', ')}`,
        `Expenses: ${result.expenseCount}`,
        `Subscriptions: ${result.subscriptionCount}`,
        `Subscription payments: ${result.subscriptionPaymentCount}`,
        `Loans and debts: ${result.debtCount}`,
        `Debt payments: ${result.debtPaymentCount}`,
        '',
      ].join('\n'),
    );
  } finally {
    await database.destroy();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Demo data seeding failed.';
  console.error(`Demo seed failed: ${message}`);
  process.exitCode = 1;
});
