import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  runMigrations,
  type BizzieMoneyDatabase,
} from '@bizziemoney/database';
import {
  createStorageRegistry,
  type StorageRegistry,
} from '@bizziemoney/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/service';
import { PostgresAuthStore } from '../auth/store';
import { DataService } from './service';
import { PostgresDataStore } from './store';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_data_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-07-29T00:00:00.000Z');
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let storage: StorageRegistry;
let storageDirectory = '';
let ownerId = '';
let sessionId = '';
let categoryId = '';
let paymentMethodId = '';
let store: PostgresDataStore;
let service: DataService;

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

function parseTar(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim() ||
        '0',
      8,
    );
    offset += 512;
    entries.set(name, archive.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function seedFinancialRecords(): Promise<{
  attachmentId: string;
  attachmentText: string;
}> {
  const expenseId = randomUUID();
  const subscriptionId = randomUUID();
  const debtId = randomUUID();
  const tagId = randomUUID();
  const attachmentId = randomUUID();
  const attachmentText = 'private receipt contents';
  const attachmentFile = join(storageDirectory, `${attachmentId}.source`);
  const objectKey = `owners/${ownerId}/${attachmentId}/original`;
  const checksumSha256 = createHash('sha256')
    .update(attachmentText)
    .digest('hex');
  await writeFile(attachmentFile, attachmentText);
  await storage.active.putFile({
    checksumSha256,
    filePath: attachmentFile,
    mimeType: 'image/png',
    objectKey,
  });

  await testDatabase!
    .insertInto('tags')
    .values({
      id: tagId,
      name: 'Private',
      normalized_name: 'private',
      owner_id: ownerId,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('expenses')
    .values({
      amount: '14.25',
      category_id: categoryId,
      currency_code: 'USD',
      description: 'Private receipt',
      expense_date: '2026-07-28',
      id: expenseId,
      merchant: 'Corner shop',
      notes: 'Export me',
      owner_id: ownerId,
      payment_method_id: paymentMethodId,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('expense_tags')
    .values({
      expense_id: expenseId,
      owner_id: ownerId,
      tag_id: tagId,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('subscriptions')
    .values({
      amount: '12.50',
      billing_frequency: 'monthly',
      category_id: categoryId,
      currency_code: 'USD',
      custom_interval_days: null,
      id: subscriptionId,
      name: 'Streaming',
      next_payment_date: '2026-08-01',
      owner_id: ownerId,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('subscription_payments')
    .values({
      amount: '12.50',
      converted_expense_id: null,
      currency_code: 'USD',
      id: randomUUID(),
      owner_id: ownerId,
      paid_date: '2026-07-01',
      scheduled_date: '2026-07-01',
      subscription_id: subscriptionId,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('debts')
    .values({
      currency_code: 'USD',
      direction: 'i_owe',
      id: debtId,
      name: 'Personal loan',
      original_amount: '100.00',
      owner_id: ownerId,
      start_date: '2026-07-01',
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('debt_payments')
    .values({
      amount: '10.00',
      debt_id: debtId,
      id: randomUUID(),
      notes: null,
      owner_id: ownerId,
      payment_date: '2026-07-15',
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('attachments')
    .values({
      checksum_sha256: checksumSha256,
      display_name: 'Receipt',
      id: attachmentId,
      mime_type: 'image/png',
      object_key: objectKey,
      original_file_name: 'receipt.png',
      owner_id: ownerId,
      size_bytes: Buffer.byteLength(attachmentText),
      storage_provider: 'local',
      storage_root: storage.active.rootIdentifier,
    })
    .executeTakeFirstOrThrow();
  await testDatabase!
    .insertInto('entity_attachments')
    .values({
      attachment_id: attachmentId,
      entity_id: expenseId,
      entity_type: 'expense',
      owner_id: ownerId,
    })
    .executeTakeFirstOrThrow();

  return { attachmentId, attachmentText };
}

integrationDescribe('PostgreSQL portable data management', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-data-integration-admin',
      connectionString: baseConnectionString!,
      maxConnections: 1,
    });
    await adminDatabase.schema.createSchema(schemaName).execute();
    const isolatedConnectionString = schemaConnectionString(
      baseConnectionString!,
    );
    await runMigrations({
      connectionString: isolatedConnectionString,
      migrationsDirectory: fileURLToPath(
        new URL('../../../../packages/database/migrations', import.meta.url),
      ),
    });
    testDatabase = createDatabase({
      applicationName: 'bizziemoney-data-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 3,
    });
    const authService = new AuthService(
      new PostgresAuthStore(testDatabase),
      'portable-data-integration-session-secret',
      24,
    );
    const auth = await authService.setupOwner(
      'Jamie',
      'jamie@example.com',
      'portable-data-integration-password',
      { ipAddress: '127.0.0.1', userAgent: 'Integration test' },
    );
    ownerId = auth.owner.id;
    sessionId = (await authService.authenticate(auth.secrets.sessionToken))!.id;
    const category = await testDatabase
      .selectFrom('categories')
      .select('id')
      .where('owner_id', '=', ownerId)
      .where('normalized_name', '=', 'other')
      .executeTakeFirstOrThrow();
    const paymentMethod = await testDatabase
      .selectFrom('payment_methods')
      .select('id')
      .where('owner_id', '=', ownerId)
      .where('normalized_name', '=', 'other')
      .executeTakeFirstOrThrow();
    categoryId = category.id;
    paymentMethodId = paymentMethod.id;
    await testDatabase
      .insertInto('backup_configs')
      .values({ owner_id: ownerId })
      .executeTakeFirstOrThrow();
    storageDirectory = await mkdtemp(
      join(tmpdir(), 'bizziemoney-data-storage-'),
    );
    storage = createStorageRegistry({
      activeProvider: 'local',
      localPath: join(storageDirectory, 'objects'),
      s3: null,
    });
    store = new PostgresDataStore(testDatabase);
    service = new DataService(store, storage, () => now);
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
    if (storageDirectory) {
      await rm(storageDirectory, { force: true, recursive: true });
    }
  });

  it('exports portable records and files without authentication secrets', async () => {
    const seeded = await seedFinancialRecords();
    const archive = await service.createPortableExport(ownerId);
    const entries = parseTar(gunzipSync(await readFile(archive.filePath)));
    const manifest = JSON.parse(
      entries.get('manifest.json')!.toString('utf8'),
    ) as {
      attachmentCount: number;
      format: string;
      schemaVersion: number;
    };
    const records = entries
      .get('records.ndjson')!
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { data: object; type: string });
    const serializedRecords = JSON.stringify(records);

    expect(manifest).toMatchObject({
      attachmentCount: 1,
      format: 'bizziemoney-portable-export',
      schemaVersion: 16,
    });
    expect(records.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'owner',
        'preferences',
        'expense',
        'subscription',
        'debt',
        'attachment',
        'entityAttachment',
      ]),
    );
    expect(serializedRecords).toContain('Private receipt');
    expect(serializedRecords).not.toContain('passwordHash');
    expect(serializedRecords).not.toContain('tokenHash');
    expect(serializedRecords).not.toContain('storageRoot');
    expect(
      entries
        .get(`attachments/${seeded.attachmentId}/original.png`)
        ?.toString('utf8'),
    ).toBe(seeded.attachmentText);
    await archive.cleanup();
  });

  it('atomically purges financial records, preserves settings, and replays safely', async () => {
    const idempotencyKey = randomUUID();
    const first = await service.purgeFinancialData(
      sessionId,
      ownerId,
      idempotencyKey,
      'DELETE ALL DATA',
    );
    const replay = await service.purgeFinancialData(
      sessionId,
      ownerId,
      idempotencyKey,
      'DELETE ALL DATA',
    );

    expect(first).toMatchObject({
      attachmentFilesQueued: 2,
      attachments: 1,
      debtPayments: 1,
      debts: 1,
      expenses: 1,
      replayed: false,
      subscriptionPayments: 1,
      subscriptions: 1,
      tags: 1,
    });
    expect(replay).toMatchObject({ ...first, replayed: true });
    const remaining = await Promise.all([
      testDatabase!
        .selectFrom('expenses')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('owner_id', '=', ownerId)
        .executeTakeFirstOrThrow(),
      testDatabase!
        .selectFrom('subscriptions')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('owner_id', '=', ownerId)
        .executeTakeFirstOrThrow(),
      testDatabase!
        .selectFrom('debts')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('owner_id', '=', ownerId)
        .executeTakeFirstOrThrow(),
      testDatabase!
        .selectFrom('attachments')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('owner_id', '=', ownerId)
        .executeTakeFirstOrThrow(),
    ]);
    expect(remaining.map(({ count }) => Number(count))).toEqual([0, 0, 0, 0]);
    expect(
      await testDatabase!
        .selectFrom('app_settings')
        .select('owner_id')
        .where('owner_id', '=', ownerId)
        .executeTakeFirst(),
    ).toBeDefined();
    expect(
      await testDatabase!
        .selectFrom('backup_configs')
        .select('owner_id')
        .where('owner_id', '=', ownerId)
        .executeTakeFirst(),
    ).toBeDefined();
    const cleanupJobs = await testDatabase!
      .selectFrom('attachment_cleanup_jobs')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(Number(cleanupJobs.count)).toBe(2);
    const audits = await testDatabase!
      .selectFrom('audit_events')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('owner_id', '=', ownerId)
      .where('event_type', '=', 'data.financial_purged')
      .executeTakeFirstOrThrow();
    expect(Number(audits.count)).toBe(1);
  });

  it('refuses to purge while backup work is queued and leaves data untouched', async () => {
    const expenseId = randomUUID();
    await testDatabase!
      .insertInto('expenses')
      .values({
        amount: '1.00',
        category_id: categoryId,
        currency_code: 'USD',
        description: 'Must remain',
        expense_date: '2026-07-29',
        id: expenseId,
        owner_id: ownerId,
        payment_method_id: paymentMethodId,
      })
      .executeTakeFirstOrThrow();
    const jobId = randomUUID();
    await testDatabase!
      .insertInto('backup_jobs')
      .values({
        id: jobId,
        idempotency_key: `integration-${jobId}`,
        kind: 'backup',
        owner_id: ownerId,
        status: 'queued',
        trigger_type: 'manual',
      })
      .executeTakeFirstOrThrow();

    await expect(
      service.purgeFinancialData(
        sessionId,
        ownerId,
        randomUUID(),
        'DELETE ALL DATA',
      ),
    ).rejects.toMatchObject({
      code: 'DATA_OPERATION_ACTIVE',
      statusCode: 409,
    });
    expect(
      await testDatabase!
        .selectFrom('expenses')
        .select('id')
        .where('id', '=', expenseId)
        .executeTakeFirst(),
    ).toBeDefined();
  });
});
