import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg, { type PoolClient } from 'pg';

import { runMigrations } from './migrations';

const { Pool } = pg;
const DEFAULT_EXPENSE_COUNT = 1_000_000;
const DEFAULT_SUBSCRIPTION_COUNT = 100_000;
const DEFAULT_DEBT_COUNT = 100_000;
const DEFAULT_PAYMENT_COUNT = 25_000;
const DEFAULT_MAX_QUERY_MS = 1_500;

interface ExplainNode {
  'Actual Rows'?: number;
  'Index Name'?: string;
  'Node Type': string;
  Plans?: ExplainNode[];
}

interface ExplainResult {
  'Execution Time': number;
  Plan: ExplainNode;
}

interface ExplainRow {
  'QUERY PLAN': ExplainResult[];
}

interface BenchmarkScenario {
  expectedIndex: string;
  name: string;
  parameters: unknown[];
  statement: string;
}

interface ScenarioResult {
  executionMs: number;
  indexNames: string[];
  name: string;
  nodeTypes: string[];
}

function readCount(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1,000 and ${maximum}.`);
  }
  return parsed;
}

function readMaximumQueryTime(): number {
  const raw = process.env.PERFORMANCE_MAX_QUERY_MS;
  if (!raw) return DEFAULT_MAX_QUERY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 50 || parsed > 30_000) {
    throw new Error('PERFORMANCE_MAX_QUERY_MS must be between 50 and 30000.');
  }
  return parsed;
}

function schemaConnectionString(
  connectionString: string,
  schemaName: string,
): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

function collectPlanDetails(
  node: ExplainNode,
  indexes: Set<string>,
  nodeTypes: Set<string>,
): void {
  nodeTypes.add(node['Node Type']);
  if (node['Index Name']) indexes.add(node['Index Name']);
  for (const child of node.Plans ?? []) {
    collectPlanDetails(child, indexes, nodeTypes);
  }
}

async function timed<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const result = await operation();
  const elapsed = Math.round(performance.now() - startedAt);
  console.info(`${label}: ${elapsed.toLocaleString('en-US')} ms`);
  return result;
}

async function seedOwner(client: PoolClient): Promise<{
  categoryId: string;
  ownerId: string;
  paymentMethodId: string;
}> {
  const ownerId = randomUUID();
  await client.query(
    `
      insert into app_users (
        id,
        email,
        normalized_email,
        display_name,
        password_hash
      )
      values ($1, 'performance@example.invalid', 'performance@example.invalid',
        'Performance Fixture', '$argon2id$performance-fixture-not-for-login')
    `,
    [ownerId],
  );
  await client.query('insert into app_settings (owner_id) values ($1)', [
    ownerId,
  ]);
  await client.query('select seed_owner_expense_defaults($1)', [ownerId]);
  const references = await client.query<{
    category_id: string;
    payment_method_id: string;
  }>(
    `
      select
        (select id from categories where owner_id = $1 order by id limit 1)
          as category_id,
        (select id from payment_methods where owner_id = $1 order by id limit 1)
          as payment_method_id
    `,
    [ownerId],
  );
  const row = references.rows[0];
  if (!row) throw new Error('Performance fixture defaults were not created.');
  return {
    categoryId: row.category_id,
    ownerId,
    paymentMethodId: row.payment_method_id,
  };
}

async function seedExpenses(
  client: PoolClient,
  input: {
    categoryId: string;
    count: number;
    ownerId: string;
    paymentMethodId: string;
  },
): Promise<void> {
  await client.query(
    `
      insert into expenses (
        id,
        owner_id,
        expense_date,
        description,
        amount,
        currency_code,
        category_id,
        payment_method_id,
        merchant,
        notes,
        created_at,
        updated_at
      )
      select
        gen_random_uuid(),
        $1::uuid,
        date '2020-01-01' + (series_id % 2400)::integer,
        case
          when series_id % 1000 = 0
            then 'Performance benchmark needle ' || series_id
          else 'Synthetic expense ' || series_id
        end,
        ((series_id % 250000) + 1)::numeric / 100,
        'USD',
        $2::uuid,
        $3::uuid,
        case when series_id % 5 = 0 then 'Fixture merchant' else null end,
        null,
        now() - make_interval(secs => series_id % 100000),
        now() - make_interval(secs => series_id % 100000)
      from generate_series(1, $4::integer) as fixture(series_id)
    `,
    [input.ownerId, input.categoryId, input.paymentMethodId, input.count],
  );
}

async function seedSubscriptions(
  client: PoolClient,
  input: {
    categoryId: string;
    count: number;
    ownerId: string;
    paymentCount: number;
  },
): Promise<void> {
  await client.query(
    `
      insert into subscriptions (
        id,
        owner_id,
        name,
        amount,
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
      )
      select
        gen_random_uuid(),
        $1::uuid,
        case
          when series_id % 500 = 0
            then 'Performance streaming needle ' || series_id
          else 'Synthetic subscription ' || series_id
        end,
        ((series_id % 50000) + 100)::numeric / 100,
        'USD',
        'monthly',
        null,
        current_date + (series_id % 365)::integer,
        $2::uuid,
        series_id % 4 <> 0,
        series_id % 30,
        case when series_id % 10 = 0 then 'paused' else 'active' end,
        current_date - 365,
        null,
        null,
        now() - make_interval(secs => series_id % 100000),
        now() - make_interval(secs => series_id % 100000)
      from generate_series(1, $3::integer) as fixture(series_id)
    `,
    [input.ownerId, input.categoryId, input.count],
  );
  await client.query(
    `
      insert into subscription_payments (
        id,
        owner_id,
        subscription_id,
        scheduled_date,
        paid_date,
        amount,
        currency_code
      )
      select
        gen_random_uuid(),
        owner_id,
        id,
        next_payment_date - 30,
        next_payment_date - 30,
        amount,
        currency_code
      from subscriptions
      where owner_id = $1::uuid
      limit $2::integer
    `,
    [input.ownerId, Math.min(input.paymentCount, input.count)],
  );
}

async function seedDebts(
  client: PoolClient,
  input: { count: number; ownerId: string; paymentCount: number },
): Promise<void> {
  await client.query(
    `
      insert into debts (
        id,
        owner_id,
        direction,
        name,
        original_amount,
        currency_code,
        start_date,
        due_date,
        installment_amount,
        installment_frequency,
        custom_interval_days,
        next_payment_date,
        interest_note,
        status,
        notes,
        completed_at,
        created_at,
        updated_at
      )
      select
        gen_random_uuid(),
        $1::uuid,
        case when series_id % 2 = 0 then 'i_owe' else 'owed_to_me' end,
        case
          when series_id % 500 = 0
            then 'Performance lender needle ' || series_id
          else 'Synthetic lender ' || series_id
        end,
        ((series_id % 1000000) + 1000)::numeric / 100,
        'USD',
        current_date - 730,
        current_date + ((series_id % 730) - 365)::integer,
        null,
        null,
        null,
        null,
        null,
        case
          when series_id % 730 < 365 then 'overdue'
          else 'active'
        end,
        null,
        null,
        now() - make_interval(secs => series_id % 100000),
        now() - make_interval(secs => series_id % 100000)
      from generate_series(1, $2::integer) as fixture(series_id)
    `,
    [input.ownerId, input.count],
  );
  await client.query(
    `
      insert into debt_payments (
        id,
        owner_id,
        debt_id,
        payment_date,
        amount,
        notes
      )
      select
        gen_random_uuid(),
        owner_id,
        id,
        current_date - 30,
        least(original_amount / 4, 100),
        null
      from debts
      where owner_id = $1::uuid
      limit $2::integer
    `,
    [input.ownerId, Math.min(input.paymentCount, input.count)],
  );
}

async function verifyIndexes(client: PoolClient): Promise<void> {
  const expected = [
    'debts_owner_direction_due_active_idx',
    'expenses_owner_amount_id_active_idx',
    'expenses_owner_date_id_active_idx',
    'expenses_owner_updated_id_active_idx',
    'subscriptions_owner_amount_active_idx',
    'subscriptions_owner_next_active_idx',
    'subscriptions_owner_updated_active_idx',
  ];
  const result = await client.query<{ indexname: string }>(
    `
      select indexname
      from pg_indexes
      where schemaname = current_schema()
        and indexname = any($1::text[])
    `,
    [expected],
  );
  const found = new Set(result.rows.map((row) => row.indexname));
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Required indexes are missing: ${missing.join(', ')}`);
  }
}

async function runScenario(
  client: PoolClient,
  scenario: BenchmarkScenario,
  maximumQueryMs: number,
): Promise<ScenarioResult> {
  const result = await client.query<ExplainRow>(
    `explain (analyze, buffers, format json) ${scenario.statement}`,
    scenario.parameters,
  );
  const explain = result.rows[0]?.['QUERY PLAN'][0];
  if (!explain)
    throw new Error(`${scenario.name} did not return a query plan.`);
  const indexNames = new Set<string>();
  const nodeTypes = new Set<string>();
  collectPlanDetails(explain.Plan, indexNames, nodeTypes);
  if (!indexNames.has(scenario.expectedIndex)) {
    throw new Error(
      `${scenario.name} did not use ${scenario.expectedIndex}. Used: ${
        [...indexNames].join(', ') || 'no index'
      }.`,
    );
  }
  if (explain['Execution Time'] > maximumQueryMs) {
    throw new Error(
      `${scenario.name} took ${explain['Execution Time'].toFixed(2)} ms, above ${maximumQueryMs} ms.`,
    );
  }
  return {
    executionMs: explain['Execution Time'],
    indexNames: [...indexNames].sort(),
    name: scenario.name,
    nodeTypes: [...nodeTypes].sort(),
  };
}

async function benchmark(client: PoolClient, ownerId: string): Promise<void> {
  const maximumQueryMs = readMaximumQueryTime();
  await verifyIndexes(client);
  const scenarios: BenchmarkScenario[] = [
    {
      expectedIndex: 'expenses_owner_date_id_active_idx',
      name: 'Recent expense page',
      parameters: [ownerId],
      statement: `
        select id, expense_date, description, amount
        from expenses
        where owner_id = $1::uuid and deleted_at is null
        order by expense_date desc, id desc
        limit 26
      `,
    },
    {
      expectedIndex: 'expenses_search_idx',
      name: 'Expense full-text search',
      parameters: [ownerId, 'benchmark needle'],
      statement: `
        select id
        from expenses
        where owner_id = $1::uuid
          and deleted_at is null
          and search_vector @@ websearch_to_tsquery('simple', $2)
        order by expense_date desc, id desc
        limit 26
      `,
    },
    {
      expectedIndex: 'subscriptions_owner_next_active_idx',
      name: 'Upcoming subscription page',
      parameters: [ownerId],
      statement: `
        select id, next_payment_date, amount
        from subscriptions
        where owner_id = $1::uuid and deleted_at is null
        order by next_payment_date, id
        limit 26
      `,
    },
    {
      expectedIndex: 'subscriptions_owner_amount_active_idx',
      name: 'Subscription amount sort',
      parameters: [ownerId],
      statement: `
        select id, amount
        from subscriptions
        where owner_id = $1::uuid and deleted_at is null
        order by amount desc, id desc
        limit 26
      `,
    },
    {
      expectedIndex: 'subscriptions_owner_updated_active_idx',
      name: 'Subscription update sort',
      parameters: [ownerId],
      statement: `
        select id, updated_at
        from subscriptions
        where owner_id = $1::uuid and deleted_at is null
        order by updated_at desc, id desc
        limit 26
      `,
    },
    {
      expectedIndex: 'debts_owner_direction_due_active_idx',
      name: 'Money owed due-date page',
      parameters: [ownerId, 'i_owe'],
      statement: `
        select id, due_date
        from debts
        where owner_id = $1::uuid
          and direction = $2
          and deleted_at is null
        order by coalesce(next_payment_date, due_date, '9999-12-31'::date), id
        limit 26
      `,
    },
  ];
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(client, scenario, maximumQueryMs));
  }
  console.info(
    JSON.stringify(
      {
        maximumQueryMs,
        scenarios: results.map((result) => ({
          ...result,
          executionMs: Number(result.executionMs.toFixed(3)),
        })),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const connectionString =
    process.env.PERFORMANCE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Set PERFORMANCE_DATABASE_URL or TEST_DATABASE_URL to an isolated PostgreSQL database.',
    );
  }
  const counts = {
    debts: readCount(
      'PERFORMANCE_DEBT_COUNT',
      DEFAULT_DEBT_COUNT,
      DEFAULT_DEBT_COUNT,
    ),
    expenses: readCount(
      'PERFORMANCE_EXPENSE_COUNT',
      DEFAULT_EXPENSE_COUNT,
      DEFAULT_EXPENSE_COUNT,
    ),
    payments: readCount(
      'PERFORMANCE_PAYMENT_COUNT',
      DEFAULT_PAYMENT_COUNT,
      DEFAULT_SUBSCRIPTION_COUNT,
    ),
    subscriptions: readCount(
      'PERFORMANCE_SUBSCRIPTION_COUNT',
      DEFAULT_SUBSCRIPTION_COUNT,
      DEFAULT_SUBSCRIPTION_COUNT,
    ),
  };
  const schemaName = `bm_perf_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({
    application_name: 'bizziemoney-performance-admin',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const isolatedConnectionString = schemaConnectionString(
    connectionString,
    schemaName,
  );
  let fixturePool: InstanceType<typeof Pool> | undefined;
  try {
    await adminPool.query(`create schema "${schemaName}"`);
    await timed('Migrations', () =>
      runMigrations({
        connectionString: isolatedConnectionString,
        migrationsDirectory: fileURLToPath(
          new URL('../migrations', import.meta.url),
        ),
      }),
    );
    fixturePool = new Pool({
      application_name: 'bizziemoney-performance',
      connectionString: isolatedConnectionString,
      connectionTimeoutMillis: 5_000,
      max: 1,
      statement_timeout: 900_000,
    });
    const client = await fixturePool.connect();
    try {
      await client.query('set synchronous_commit = off');
      const owner = await seedOwner(client);
      await timed(
        `Seed ${counts.expenses.toLocaleString('en-US')} expenses`,
        () =>
          seedExpenses(client, {
            categoryId: owner.categoryId,
            count: counts.expenses,
            ownerId: owner.ownerId,
            paymentMethodId: owner.paymentMethodId,
          }),
      );
      await timed(
        `Seed ${counts.subscriptions.toLocaleString('en-US')} subscriptions`,
        () =>
          seedSubscriptions(client, {
            categoryId: owner.categoryId,
            count: counts.subscriptions,
            ownerId: owner.ownerId,
            paymentCount: counts.payments,
          }),
      );
      await timed(`Seed ${counts.debts.toLocaleString('en-US')} debts`, () =>
        seedDebts(client, {
          count: counts.debts,
          ownerId: owner.ownerId,
          paymentCount: counts.payments,
        }),
      );
      await timed('Analyze synthetic fixtures', () =>
        client.query(
          'analyze expenses; analyze subscriptions; analyze subscription_payments; analyze debts; analyze debt_payments;',
        ),
      );
      await benchmark(client, owner.ownerId);
      console.info(
        `Performance verification passed in isolated schema ${schemaName}.`,
      );
    } finally {
      client.release();
    }
  } finally {
    await fixturePool?.end();
    await adminPool.query(`drop schema if exists "${schemaName}" cascade`);
    await adminPool.end();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown performance error';
  console.error(`Performance verification failed: ${message}`);
  process.exitCode = 1;
});
