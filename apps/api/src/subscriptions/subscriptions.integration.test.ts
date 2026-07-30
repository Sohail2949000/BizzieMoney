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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AttachmentService } from '../attachments/service.js';
import { PostgresAttachmentStore } from '../attachments/store.js';
import { AuthService } from '../auth/service.js';
import { PostgresAuthStore } from '../auth/store.js';
import { ExpenseService } from '../expenses/service.js';
import { PostgresExpenseStore } from '../expenses/store.js';
import { SubscriptionService } from './service.js';
import { PostgresSubscriptionStore } from './store.js';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_subscriptions_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let service: SubscriptionService;
let attachmentService: AttachmentService;
let expenseService: ExpenseService;
let attachmentDirectory = '';
let ownerId = '';
let sessionId = '';
let categoryId = '';
let paymentMethodId = '';

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

function localDate(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(value.getDate()).padStart(2, '0')}`;
}

integrationDescribe('PostgreSQL subscriptions', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-subscriptions-integration-admin',
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
      applicationName: 'bizziemoney-subscriptions-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 3,
    });
    const authService = new AuthService(
      new PostgresAuthStore(testDatabase),
      'subscription-integration-session-secret-long-enough',
      24,
    );
    const auth = await authService.setupOwner(
      'Jamie',
      'jamie@example.com',
      'subscription-integration-password',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'Integration test',
      },
    );
    ownerId = auth.owner.id;
    sessionId = (await authService.authenticate(auth.secrets.sessionToken))!.id;
    const expenseStore = new PostgresExpenseStore(testDatabase);
    expenseService = new ExpenseService(expenseStore);
    const options = await expenseService.getOptions(ownerId, false);
    categoryId = options.categories.find(
      (category) => category.name === 'Bills & Utilities',
    )!.id;
    paymentMethodId = options.paymentMethods.find(
      (method) => method.name === 'Bank card',
    )!.id;
    service = new SubscriptionService(
      new PostgresSubscriptionStore(testDatabase),
    );
    attachmentDirectory = await mkdtemp(
      join(tmpdir(), 'bizziemoney-subscription-attachments-'),
    );
    attachmentService = new AttachmentService(
      new PostgresAttachmentStore(testDatabase),
      createStorageRegistry({
        activeProvider: 'local',
        localPath: attachmentDirectory,
        s3: null,
      }),
      1_048_576,
      new Set(['text/plain']),
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

  it('persists schedules, idempotent payments, conversion, status, and attachments', async () => {
    const today = localDate();
    const subscription = await service.create(ownerId, sessionId, {
      amount: '29.99',
      autoRenew: true,
      billingFrequency: 'monthly',
      categoryId,
      customIntervalDays: null,
      endDate: null,
      name: 'Home internet',
      nextPaymentDate: today,
      notes: 'Fibre plan',
      reminderDays: 0,
      startDate: today,
    });

    expect(
      await service.list(ownerId, {
        dateFrom: today,
        dateTo: today,
        limit: 25,
        search: 'internet',
        sort: 'next_asc',
        status: 'active',
      }),
    ).toMatchObject({
      items: [{ id: subscription.id, name: 'Home internet' }],
      nextCursor: null,
    });
    expect(
      await service.list(ownerId, {
        dateFrom: '2099-01-01',
        dateTo: '2099-01-31',
        limit: 25,
        sort: 'next_asc',
      }),
    ).toMatchObject({ items: [] });
    await expect(
      service.get(randomUUID(), subscription.id),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });

    const uploaded = await attachmentService.uploadSubscriptionAttachment({
      declaredMimeType: 'text/plain',
      entityId: subscription.id,
      entityType: 'subscription',
      fileName: 'contract.txt',
      idempotencyKey: randomUUID(),
      ownerId,
      sessionId,
      stream: Readable.from(Buffer.from('safe subscription contract')),
    });
    expect(
      await attachmentService.listSubscriptionAttachments(
        ownerId,
        subscription.id,
      ),
    ).toHaveLength(1);
    expect((await service.get(ownerId, subscription.id)).attachmentCount).toBe(
      1,
    );

    const upcoming = await service.listUpcoming(ownerId, 30, 10);
    expect(upcoming.items).toEqual([
      expect.objectContaining({ id: subscription.id, nextPaymentDate: today }),
    ]);

    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'EUR' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const paymentKey = randomUUID();
    const recorded = await service.recordPayment(
      ownerId,
      sessionId,
      subscription.id,
      paymentKey,
      { amount: null, paidDate: today },
    );
    const replayed = await service.recordPayment(
      ownerId,
      sessionId,
      subscription.id,
      paymentKey,
      { amount: null, paidDate: today },
    );
    expect(recorded.replayed).toBe(false);
    expect(recorded.payment.currencyCode).toBe('USD');
    expect(replayed).toMatchObject({
      payment: { id: recorded.payment.id },
      replayed: true,
    });
    await expect(
      service.recordPayment(ownerId, sessionId, subscription.id, paymentKey, {
        amount: '30.00',
        paidDate: today,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const conversionKey = randomUUID();
    const conversion = await service.convertPaymentToExpense(
      ownerId,
      sessionId,
      recorded.payment.id,
      conversionKey,
      paymentMethodId,
    );
    const conversionReplay = await service.convertPaymentToExpense(
      ownerId,
      sessionId,
      recorded.payment.id,
      conversionKey,
      paymentMethodId,
    );
    expect(conversionReplay).toEqual({
      expenseId: conversion.expenseId,
      replayed: true,
    });
    await expect(
      expenseService.getExpense(ownerId, conversion.expenseId),
    ).resolves.toMatchObject({
      amount: '29.9900',
      currencyCode: 'USD',
      description: 'Home internet',
    });
    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'USD' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(
      (await service.listPayments(ownerId, subscription.id, undefined, 25))
        .items[0],
    ).toMatchObject({ convertedExpenseId: conversion.expenseId });

    await expect(
      service.pause(ownerId, sessionId, subscription.id),
    ).resolves.toMatchObject({ status: 'paused' });
    await expect(
      service.resume(ownerId, sessionId, subscription.id),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      service.cancel(ownerId, sessionId, subscription.id),
    ).resolves.toMatchObject({ status: 'cancelled' });

    await service.delete(ownerId, sessionId, subscription.id);
    await expect(service.get(ownerId, subscription.id)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    await expect(
      attachmentService.getContent(ownerId, uploaded.attachment.id),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    const cleanup = await testDatabase!
      .selectFrom('attachment_cleanup_jobs')
      .select(['attachment_id', 'status'])
      .where('owner_id', '=', ownerId)
      .where('attachment_id', '=', uploaded.attachment.id)
      .executeTakeFirst();
    expect(cleanup).toMatchObject({
      attachment_id: uploaded.attachment.id,
      status: 'pending',
    });
  });
});
