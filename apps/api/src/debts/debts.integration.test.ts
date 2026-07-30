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
import { DebtService } from './service.js';
import { PostgresDebtStore } from './store.js';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_debts_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let service: DebtService;
let attachmentService: AttachmentService;
let attachmentDirectory = '';
let ownerId = '';
let sessionId = '';

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

integrationDescribe('PostgreSQL loans and debts', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-debts-integration-admin',
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
      applicationName: 'bizziemoney-debts-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 3,
    });
    const authService = new AuthService(
      new PostgresAuthStore(testDatabase),
      'debt-integration-session-secret-long-enough',
      24,
    );
    const auth = await authService.setupOwner(
      'Jamie',
      'jamie@example.com',
      'debt-integration-password',
      {
        ipAddress: '127.0.0.1',
        userAgent: 'Integration test',
      },
    );
    ownerId = auth.owner.id;
    sessionId = (await authService.authenticate(auth.secrets.sessionToken))!.id;
    service = new DebtService(new PostgresDebtStore(testDatabase));
    attachmentDirectory = await mkdtemp(
      join(tmpdir(), 'bizziemoney-debt-attachments-'),
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

  it('creates debt, validates partial and full payments, and protects overpayments', async () => {
    const today = localDate();
    const debt = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: today,
      installmentAmount: '250',
      installmentFrequency: 'monthly',
      interestNote: 'Fixed rate noted in the agreement',
      name: 'Community bank',
      nextPaymentDate: today,
      notes: 'Car loan',
      originalAmount: '1000',
      startDate: today,
    });
    expect(debt).toMatchObject({
      originalAmount: '1000.0000',
      remainingAmount: '1000.0000',
      status: 'active',
    });
    expect(
      await service.list(ownerId, {
        dateFrom: today,
        dateTo: today,
        direction: 'i_owe',
        limit: 25,
        search: 'community',
        sort: 'due_asc',
      }),
    ).toMatchObject({ items: [{ id: debt.id }] });
    expect(
      await service.list(ownerId, {
        dateFrom: '2099-01-01',
        dateTo: '2099-01-31',
        direction: 'i_owe',
        limit: 25,
        sort: 'due_asc',
      }),
    ).toMatchObject({ items: [] });
    await expect(service.get(randomUUID(), debt.id)).rejects.toMatchObject({
      code: 'DEBT_NOT_FOUND',
    });

    const agreement = await attachmentService.uploadDebtAttachment({
      declaredMimeType: 'text/plain',
      entityId: debt.id,
      entityType: 'debt',
      fileName: 'agreement.txt',
      idempotencyKey: randomUUID(),
      ownerId,
      sessionId,
      stream: Readable.from(Buffer.from('safe agreement')),
    });
    expect(
      await attachmentService.listDebtAttachments(ownerId, debt.id),
    ).toHaveLength(1);

    const partialKey = randomUUID();
    const partial = await service.recordPayment(
      ownerId,
      sessionId,
      debt.id,
      partialKey,
      {
        allowOverpayment: false,
        amount: '250',
        notes: 'First installment',
        paymentDate: today,
      },
    );
    expect(partial.replayed).toBe(false);
    expect(
      await service.recordPayment(ownerId, sessionId, debt.id, partialKey, {
        allowOverpayment: false,
        amount: '250',
        notes: 'First installment',
        paymentDate: today,
      }),
    ).toMatchObject({ payment: { id: partial.payment.id }, replayed: true });
    expect(await service.get(ownerId, debt.id)).toMatchObject({
      paidAmount: '250.0000',
      remainingAmount: '750.0000',
      status: 'active',
    });

    await expect(
      service.recordPayment(ownerId, sessionId, debt.id, randomUUID(), {
        allowOverpayment: false,
        amount: '751',
        notes: null,
        paymentDate: today,
      }),
    ).rejects.toMatchObject({ code: 'DEBT_PAYMENT_EXCEEDS_REMAINING' });
    expect((await service.get(ownerId, debt.id)).remainingAmount).toBe(
      '750.0000',
    );

    const final = await service.recordPayment(
      ownerId,
      sessionId,
      debt.id,
      randomUUID(),
      {
        allowOverpayment: false,
        amount: '750',
        notes: 'Final payment',
        paymentDate: today,
      },
    );
    expect(await service.get(ownerId, debt.id)).toMatchObject({
      paidAmount: '1000.0000',
      remainingAmount: '0.0000',
      status: 'paid',
    });

    const proof = await attachmentService.uploadDebtPaymentAttachment({
      declaredMimeType: 'text/plain',
      entityId: final.payment.id,
      entityType: 'debt_payment',
      fileName: 'proof.txt',
      idempotencyKey: randomUUID(),
      ownerId,
      sessionId,
      stream: Readable.from(Buffer.from('safe payment proof')),
    });
    expect(
      await attachmentService.listDebtPaymentAttachments(
        ownerId,
        final.payment.id,
      ),
    ).toHaveLength(1);
    expect(
      (await service.listPayments(ownerId, debt.id, undefined, 25)).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachmentCount: 1,
          id: final.payment.id,
        }),
      ]),
    );

    await service.updatePayment(ownerId, sessionId, partial.payment.id, {
      allowOverpayment: false,
      amount: '200',
      notes: 'Corrected first installment',
      paymentDate: today,
    });
    expect((await service.get(ownerId, debt.id)).remainingAmount).toBe(
      '50.0000',
    );
    await expect(
      service.changeStatus(ownerId, sessionId, debt.id, 'reopen'),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      service.changeStatus(ownerId, sessionId, debt.id, 'complete'),
    ).resolves.toMatchObject({ status: 'paid' });

    const overpaidDebt = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'owed_to_me',
      dueDate: null,
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Design client',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '100',
      startDate: today,
    });
    await service.recordPayment(
      ownerId,
      sessionId,
      overpaidDebt.id,
      randomUUID(),
      {
        allowOverpayment: true,
        amount: '120',
        notes: 'Tip included',
        paymentDate: today,
      },
    );
    expect(await service.get(ownerId, overpaidDebt.id)).toMatchObject({
      overpaidAmount: '20.0000',
      remainingAmount: '0.0000',
      status: 'paid',
    });
    await expect(
      service.changeStatus(ownerId, sessionId, overpaidDebt.id, 'reopen'),
    ).rejects.toMatchObject({ code: 'DEBT_REOPEN_BALANCE_COMPLETE' });
    expect(await service.getSummary(ownerId)).toMatchObject({
      currencyGroups: [
        {
          currencyCode: 'USD',
          iOwe: '50.0000',
          owedToMe: '0.0000',
        },
      ],
      defaultCurrency: 'USD',
    });

    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'EUR' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    const euroDebt = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: today,
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Euro balance',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '25',
      startDate: today,
    });
    expect(euroDebt.currencyCode).toBe('EUR');
    expect((await service.get(ownerId, debt.id)).currencyCode).toBe('USD');
    expect((await service.getSummary(ownerId)).currencyGroups).toEqual([
      expect.objectContaining({ currencyCode: 'EUR', iOwe: '25.0000' }),
      expect.objectContaining({ currencyCode: 'USD', iOwe: '50.0000' }),
    ]);
    await service.delete(ownerId, sessionId, euroDebt.id);
    await testDatabase!
      .updateTable('app_settings')
      .set({ default_currency: 'USD' })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();

    await service.delete(ownerId, sessionId, debt.id);
    await expect(
      attachmentService.getContent(ownerId, agreement.attachment.id),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    await expect(
      attachmentService.getContent(ownerId, proof.attachment.id),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
  }, 30_000);

  it('lists debts with start, due, or payment activity in the selected month', async () => {
    const startedInJuly = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: null,
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Started in July',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '100',
      startDate: '2026-07-05',
    });
    const paidInJuly = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: '2026-12-01',
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Paid in July',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '100',
      startDate: '2026-06-01',
    });
    const dueInJuly = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: '2026-07-20',
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Due in July',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '100',
      startDate: '2026-06-01',
    });
    const outsideJuly = await service.create(ownerId, sessionId, {
      customIntervalDays: null,
      direction: 'i_owe',
      dueDate: '2026-09-01',
      installmentAmount: null,
      installmentFrequency: null,
      interestNote: null,
      name: 'Outside July',
      nextPaymentDate: null,
      notes: null,
      originalAmount: '100',
      startDate: '2026-08-01',
    });
    await service.recordPayment(
      ownerId,
      sessionId,
      paidInJuly.id,
      randomUUID(),
      {
        allowOverpayment: false,
        amount: '10',
        notes: null,
        paymentDate: '2026-07-15',
      },
    );

    const july = await service.list(ownerId, {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      direction: 'i_owe',
      limit: 25,
      sort: 'due_asc',
    });
    expect(july.items.map((debt) => debt.id)).toEqual(
      expect.arrayContaining([startedInJuly.id, paidInJuly.id, dueInJuly.id]),
    );
    expect(july.items.map((debt) => debt.id)).not.toContain(outsideJuly.id);

    await Promise.all(
      [startedInJuly, paidInJuly, dueInJuly, outsideJuly].map((debt) =>
        service.delete(ownerId, sessionId, debt.id),
      ),
    );
  }, 30_000);
});
