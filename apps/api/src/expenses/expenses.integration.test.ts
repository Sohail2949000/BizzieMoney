import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  runMigrations,
  type BizzieMoneyDatabase,
} from '@bizziemoney/database';
import { createStorageRegistry } from '@bizziemoney/storage';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AttachmentService } from '../attachments/service';
import { PostgresAttachmentStore } from '../attachments/store';
import { AuthService } from '../auth/service';
import { PostgresAuthStore } from '../auth/store';
import { SubscriptionService } from '../subscriptions/service';
import { PostgresSubscriptionStore } from '../subscriptions/store';
import { ExpenseService } from './service';
import { PostgresExpenseStore } from './store';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_expenses_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let service: ExpenseService;
let attachmentService: AttachmentService;
let attachmentDirectory = '';
let ownerId = '';
let sessionId = '';

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

integrationDescribe('PostgreSQL expenses', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-expenses-integration-admin',
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
      applicationName: 'bizziemoney-expenses-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 3,
    });
    const auth = await new AuthService(
      new PostgresAuthStore(testDatabase),
      'expense-integration-session-secret-long-enough',
      24,
    ).setupOwner('Jamie', 'jamie@example.com', 'expense-integration-password', {
      ipAddress: '127.0.0.1',
      userAgent: 'Integration test',
    });
    ownerId = auth.owner.id;
    const session = await new AuthService(
      new PostgresAuthStore(testDatabase),
      'expense-integration-session-secret-long-enough',
      24,
    ).authenticate(auth.secrets.sessionToken);
    sessionId = session!.id;
    service = new ExpenseService(new PostgresExpenseStore(testDatabase));
    attachmentDirectory = await mkdtemp(
      join(tmpdir(), 'bizziemoney-attachments-integration-'),
    );
    attachmentService = new AttachmentService(
      new PostgresAttachmentStore(testDatabase),
      createStorageRegistry({
        activeProvider: 'local',
        localPath: attachmentDirectory,
        s3: null,
      }),
      1_048_576,
      new Set(['image/png', 'text/plain']),
    );
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
    if (attachmentDirectory) {
      await rm(attachmentDirectory, { force: true, recursive: true });
    }
  });

  it('persists, searches, paginates, summarizes, exports, updates, and deletes expenses', async () => {
    const options = await service.getOptions(ownerId, false);
    expect(options.categories.length).toBeGreaterThan(5);
    expect(options.paymentMethods).toHaveLength(5);
    const food = options.categories.find(
      (category) => category.name === 'Food & Dining',
    )!;
    const transport = options.categories.find(
      (category) => category.name === 'Transport',
    )!;
    const common = {
      merchant: null,
      notes: null,
      paymentMethodId: null,
      tags: ['Personal'],
    };

    const firstKey = randomUUID();
    const first = await service.createExpense(ownerId, sessionId, firstKey, {
      ...common,
      amount: '18.50',
      categoryId: food.id,
      date: '2026-07-27',
      description: 'Lunch',
    });
    const replay = await service.createExpense(ownerId, sessionId, firstKey, {
      ...common,
      amount: '18.50',
      categoryId: food.id,
      date: '2026-07-27',
      description: 'Lunch',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.expense.id).toBe(first.expense.id);

    await service.createExpense(ownerId, sessionId, randomUUID(), {
      ...common,
      amount: '42.00',
      categoryId: transport.id,
      date: '2026-07-26',
      description: 'Train ticket',
    });
    await service.createExpense(ownerId, sessionId, randomUUID(), {
      ...common,
      amount: '7.25',
      categoryId: food.id,
      date: '2026-07-25',
      description: 'Coffee',
    });

    const pageOne = await service.listExpenses(ownerId, {
      limit: 2,
      sort: 'date_desc',
    });
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.nextCursor).not.toBeNull();
    expect(
      JSON.parse(
        Buffer.from(pageOne.nextCursor!, 'base64url').toString('utf8'),
      ),
    ).toMatchObject({ sort: 'date_desc', value: '2026-07-26' });
    const pageTwo = await service.listExpenses(ownerId, {
      cursor: pageOne.nextCursor!,
      limit: 2,
      sort: 'date_desc',
    });
    expect(pageTwo.items).toHaveLength(1);

    const search = await service.listExpenses(ownerId, {
      limit: 25,
      search: 'train',
      sort: 'date_desc',
    });
    expect(search.items.map((item) => item.description)).toEqual([
      'Train ticket',
    ]);
    const summary = await service.getSummary(ownerId, '2026-07');
    expect(summary.count).toBe(3);
    expect(summary.currencyGroups).toEqual([
      expect.objectContaining({
        currencyCode: 'USD',
        totalAmount: '67.7500',
      }),
    ]);

    let csv = '';
    for await (const chunk of service.exportExpenses(ownerId, {
      sort: 'date_desc',
    })) {
      csv += chunk;
    }
    expect(csv).toContain('Train ticket');
    expect(csv.split('\r\n')).toHaveLength(5);

    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'EUR' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const euroExpense = await service.createExpense(
      ownerId,
      sessionId,
      randomUUID(),
      {
        ...common,
        amount: '10.00',
        categoryId: food.id,
        date: '2026-07-28',
        description: 'Euro lunch',
      },
    );
    expect(euroExpense.expense.currencyCode).toBe('EUR');
    expect(
      (await service.getExpense(ownerId, first.expense.id)).currencyCode,
    ).toBe('USD');
    expect(
      (await service.getSummary(ownerId, '2026-07')).currencyGroups,
    ).toEqual([
      expect.objectContaining({
        currencyCode: 'EUR',
        totalAmount: '10.0000',
      }),
      expect.objectContaining({
        currencyCode: 'USD',
        totalAmount: '67.7500',
      }),
    ]);
    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'USD' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();

    const updated = await service.updateExpense(
      ownerId,
      sessionId,
      first.expense.id,
      {
        ...common,
        amount: '20.00',
        categoryId: food.id,
        date: '2026-07-27',
        description: 'Team lunch',
      },
    );
    expect(updated.description).toBe('Team lunch');
    const imageBytes = await sharp({
      create: {
        background: { alpha: 1, b: 190, g: 90, r: 40 },
        channels: 4,
        height: 240,
        width: 360,
      },
    })
      .png()
      .toBuffer();
    const uploaded = await attachmentService.uploadExpenseAttachment({
      declaredMimeType: 'image/png',
      entityId: first.expense.id,
      entityType: 'expense',
      fileName: '..\\receipt.png',
      idempotencyKey: randomUUID(),
      ownerId,
      sessionId,
      stream: Readable.from(imageBytes),
    });
    expect(uploaded.attachment.displayName).toBe('receipt.png');
    expect(uploaded.attachment.thumbnailAvailable).toBe(true);
    expect(
      await attachmentService.listExpenseAttachments(ownerId, first.expense.id),
    ).toHaveLength(1);
    const withAttachments = await service.listExpenses(ownerId, {
      hasAttachments: true,
      limit: 25,
      sort: 'date_desc',
    });
    expect(withAttachments.items).toHaveLength(1);
    expect(withAttachments.items[0]?.attachmentCount).toBe(1);
    const withoutAttachments = await service.listExpenses(ownerId, {
      hasAttachments: false,
      limit: 25,
      sort: 'date_desc',
    });
    expect(withoutAttachments.items).toHaveLength(3);
    const content = await attachmentService.getContent(
      ownerId,
      uploaded.attachment.id,
    );
    const chunks: Array<Buffer<ArrayBufferLike>> = [];
    for await (const chunk of content.object
      .body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(imageBytes);
    const thumbnail = await attachmentService.getThumbnail(
      ownerId,
      uploaded.attachment.id,
    );
    const thumbnailChunks: Array<Buffer<ArrayBufferLike>> = [];
    for await (const chunk of thumbnail.object
      .body as AsyncIterable<Uint8Array>) {
      thumbnailChunks.push(Buffer.from(chunk));
    }
    const thumbnailMetadata = await sharp(
      Buffer.concat(thumbnailChunks),
    ).metadata();
    expect(thumbnailMetadata).toMatchObject({
      format: 'webp',
      height: 160,
      width: 160,
    });
    await expect(
      attachmentService.getContent(randomUUID(), uploaded.attachment.id),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });

    await service.deleteExpense(ownerId, sessionId, first.expense.id);
    await expect(
      service.getExpense(ownerId, first.expense.id),
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
    const deletedAudit = await testDatabase!
      .selectFrom('audit_events')
      .select('event_type')
      .where('event_type', '=', 'expense.deleted')
      .executeTakeFirst();
    expect(deletedAudit?.event_type).toBe('expense.deleted');
    const cleanupJobs = await testDatabase!
      .selectFrom('attachment_cleanup_jobs')
      .select(['attachment_id', 'object_key', 'status'])
      .where('attachment_id', '=', uploaded.attachment.id)
      .orderBy('object_key')
      .execute();
    expect(cleanupJobs).toHaveLength(2);
    expect(cleanupJobs.map((job) => job.object_key)).toEqual([
      expect.stringMatching(/\/original$/),
      expect.stringMatching(/\/thumbnail\.webp$/),
    ]);
    expect(cleanupJobs.every((job) => job.status === 'pending')).toBe(true);
  }, 30_000);

  it('previews mixed currencies and commits the whole CSV idempotently', async () => {
    const validCsv = [
      'Date,Description,Amount,Currency,Category,Payment method,Merchant,Notes,Tags',
      '2026-07-28,Imported lunch,12.50,USD,Food & Dining,Other,Cafe,,imported; lunch',
      '2026-07-29,Imported train,21.00,EUR,Transport,Bank card,,,imported',
    ].join('\n');
    const preview = await service.previewImport(ownerId, validCsv);
    expect(preview).toMatchObject({
      errorCount: 0,
      totalRows: 2,
      validCount: 2,
    });

    const idempotencyKey = randomUUID();
    const imported = await service.importExpenses(
      ownerId,
      sessionId,
      idempotencyKey,
      validCsv,
    );
    expect(imported).toEqual({
      currencyCounts: { EUR: 1, USD: 1 },
      importedCount: 2,
      replayed: false,
    });
    await expect(
      service.importExpenses(ownerId, sessionId, idempotencyKey, validCsv),
    ).resolves.toMatchObject({ importedCount: 2, replayed: true });

    const importedRows = await testDatabase!
      .selectFrom('expenses')
      .select(['currency_code', 'description'])
      .where('owner_id', '=', ownerId)
      .where('description', 'like', 'Imported %')
      .orderBy('description')
      .execute();
    expect(importedRows).toEqual([
      { currency_code: 'USD', description: 'Imported lunch' },
      { currency_code: 'EUR', description: 'Imported train' },
    ]);
    const audit = await testDatabase!
      .selectFrom('audit_events')
      .select(['event_type', 'metadata'])
      .where('owner_id', '=', ownerId)
      .where('event_type', '=', 'expense.imported')
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({
      event_type: 'expense.imported',
      metadata: {
        currencyCounts: { EUR: 1, USD: 1 },
        importedCount: 2,
      },
    });

    const countBefore = await testDatabase!
      .selectFrom('expenses')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const invalidCsv = [
      'Date,Description,Amount,Currency,Category',
      '2026-07-30,Would be valid,9.00,USD,Food & Dining',
      '2026-02-30,Invalid row,4.00,USD,Food & Dining',
    ].join('\n');
    await expect(
      service.importExpenses(ownerId, sessionId, randomUUID(), invalidCsv),
    ).rejects.toMatchObject({ code: 'EXPENSE_IMPORT_INVALID' });
    const countAfter = await testDatabase!
      .selectFrom('expenses')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(countAfter.count).toBe(countBefore.count);
  }, 30_000);

  it('deletes a category only after atomically reassigning expenses and subscriptions', async () => {
    const source = await service.createCategory(ownerId, {
      color: '#AA3377',
      icon: 'ticket',
      name: 'Temporary category',
    });
    const replacement = await service.createCategory(ownerId, {
      color: '#3377AA',
      icon: 'circle-ellipsis',
      name: 'Replacement category',
    });
    const archived = await service.createCategory(ownerId, {
      color: '#777777',
      icon: 'receipt',
      name: 'Archived replacement',
    });
    await service.updateCategory(ownerId, archived.id, { archived: true });
    const createdExpense = await service.createExpense(
      ownerId,
      sessionId,
      randomUUID(),
      {
        amount: '15.00',
        categoryId: source.id,
        date: '2026-07-29',
        description: 'Reassignment expense',
        merchant: null,
        notes: null,
        paymentMethodId: null,
        tags: [],
      },
    );
    const subscriptionService = new SubscriptionService(
      new PostgresSubscriptionStore(testDatabase!),
    );
    const subscription = await subscriptionService.create(ownerId, sessionId, {
      amount: '9.00',
      autoRenew: true,
      billingFrequency: 'monthly',
      categoryId: source.id,
      customIntervalDays: null,
      endDate: null,
      name: 'Reassignment subscription',
      nextPaymentDate: '2026-08-29',
      notes: null,
      reminderDays: 3,
      startDate: '2026-07-29',
    });

    const preview = await service.getCategoryDeletionPreview(
      ownerId,
      source.id,
    );
    expect(preview).toMatchObject({
      category: { id: source.id },
      expenseCount: 1,
      subscriptionCount: 1,
    });
    expect(preview.replacements.map((item) => item.id)).toContain(
      replacement.id,
    );
    expect(preview.replacements.map((item) => item.id)).not.toContain(
      archived.id,
    );
    await expect(
      service.deleteCategory(ownerId, sessionId, source.id, archived.id),
    ).rejects.toMatchObject({
      code: 'CATEGORY_REPLACEMENT_INVALID',
      statusCode: 409,
    });
    await expect(
      service.deleteCategory(ownerId, sessionId, source.id, replacement.id),
    ).resolves.toMatchObject({
      deletedCategoryId: source.id,
      expenseCount: 1,
      replacement: { id: replacement.id },
      subscriptionCount: 1,
    });

    const [expenseRow, subscriptionRow, deletedCategory, audit] =
      await Promise.all([
        testDatabase!
          .selectFrom('expenses')
          .select('category_id')
          .where('owner_id', '=', ownerId)
          .where('id', '=', createdExpense.expense.id)
          .executeTakeFirstOrThrow(),
        testDatabase!
          .selectFrom('subscriptions')
          .select('category_id')
          .where('owner_id', '=', ownerId)
          .where('id', '=', subscription.id)
          .executeTakeFirstOrThrow(),
        testDatabase!
          .selectFrom('categories')
          .select('id')
          .where('owner_id', '=', ownerId)
          .where('id', '=', source.id)
          .executeTakeFirst(),
        testDatabase!
          .selectFrom('audit_events')
          .select(['event_type', 'metadata'])
          .where('owner_id', '=', ownerId)
          .where('event_type', '=', 'category.deleted')
          .executeTakeFirstOrThrow(),
      ]);
    expect(expenseRow.category_id).toBe(replacement.id);
    expect(subscriptionRow.category_id).toBe(replacement.id);
    expect(deletedCategory).toBeUndefined();
    expect(audit).toMatchObject({
      event_type: 'category.deleted',
      metadata: {
        categoryId: source.id,
        expenseCount: 1,
        replacementCategoryId: replacement.id,
        subscriptionCount: 1,
      },
    });
  }, 30_000);
});
