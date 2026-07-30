import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { currentDateInTimeZone } from '@bizziemoney/shared';

import { AppError } from '../errors';
import { debtCursorValue } from './store';
import type { DebtStore, PostgresDebtStore } from './store';
import type {
  DebtFilters,
  DebtListResponse,
  DebtPaymentListResponse,
  DebtPaymentRecord,
  DebtPaymentWriteInput,
  DebtRecord,
  DebtServiceContract,
  DebtSort,
  DebtStatus,
  DebtSummary,
  DebtUpcomingResponse,
  DebtWriteInput,
  PublicDebt,
  PublicDebtPayment,
} from './types';

const debtCursorSchema = z.object({
  id: z.uuid(),
  sort: z.enum(['due_asc', 'amount_desc', 'updated_desc']),
  value: z.string().min(1).max(64),
  version: z.literal(1),
});
const paymentCursorSchema = z.object({
  id: z.uuid(),
  paymentDate: z.string(),
  type: z.literal('debt-payment'),
  version: z.literal(1),
});

function toPublicDebt(debt: DebtRecord): PublicDebt {
  return {
    ...debt,
    createdAt: debt.createdAt.toISOString(),
    updatedAt: debt.updatedAt.toISOString(),
  };
}

function toPublicPayment(payment: DebtPaymentRecord): PublicDebtPayment {
  return {
    ...payment,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function normalizeDebtInput(input: DebtWriteInput): DebtWriteInput {
  const hasInstallment = input.installmentAmount !== null;
  return {
    ...input,
    customIntervalDays:
      hasInstallment && input.installmentFrequency === 'custom'
        ? input.customIntervalDays
        : null,
    dueDate: input.dueDate || null,
    installmentAmount: input.installmentAmount?.trim() || null,
    installmentFrequency: hasInstallment ? input.installmentFrequency : null,
    interestNote: input.interestNote?.trim() || null,
    name: input.name.trim(),
    nextPaymentDate: hasInstallment ? input.nextPaymentDate || null : null,
    notes: input.notes?.trim() || null,
    originalAmount: input.originalAmount.trim(),
  };
}

function normalizePaymentInput(
  input: DebtPaymentWriteInput,
): DebtPaymentWriteInput {
  return {
    ...input,
    amount: input.amount.trim(),
    notes: input.notes?.trim() || null,
  };
}

function encodeDebtCursor(debt: DebtRecord, filters: DebtFilters): string {
  return Buffer.from(
    JSON.stringify({
      id: debt.id,
      sort: filters.sort,
      value: debtCursorValue(debt, filters.sort),
      version: 1,
    }),
  ).toString('base64url');
}

function decodeDebtCursor(
  cursor: string | undefined,
  sort: DebtSort,
): { id: string; value: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = debtCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.sort !== sort) throw new Error('sort mismatch');
    return { id: parsed.id, value: parsed.value };
  } catch {
    throw new AppError({
      code: 'CURSOR_INVALID',
      message: 'That loans and debts page link is no longer valid.',
      statusCode: 400,
    });
  }
}

function encodePaymentCursor(payment: DebtPaymentRecord): string {
  return Buffer.from(
    JSON.stringify({
      id: payment.id,
      paymentDate: payment.paymentDate,
      type: 'debt-payment',
      version: 1,
    }),
  ).toString('base64url');
}

function decodePaymentCursor(
  cursor: string | undefined,
): { id: string; value: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = paymentCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { id: parsed.id, value: parsed.paymentDate };
  } catch {
    throw new AppError({
      code: 'CURSOR_INVALID',
      message: 'That payment-history page link is no longer valid.',
      statusCode: 400,
    });
  }
}

export class DebtService implements DebtServiceContract {
  constructor(
    private readonly store: DebtStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromPostgres(store: PostgresDebtStore): DebtService {
    return new DebtService(store);
  }

  async list(
    ownerId: string,
    input: {
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      direction: DebtFilters['direction'];
      limit: number;
      search?: string | undefined;
      sort: DebtSort;
      status?: DebtStatus | undefined;
    },
  ): Promise<DebtListResponse> {
    await this.refreshStatuses(ownerId);
    const filters: DebtFilters = {
      cursor: decodeDebtCursor(input.cursor, input.sort),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      direction: input.direction,
      limit: input.limit,
      search: input.search?.trim() || undefined,
      sort: input.sort,
      status: input.status,
    };
    const page = await this.store.listDebts(ownerId, filters);
    const last = page.items.at(-1);
    return {
      items: page.items.map(toPublicDebt),
      nextCursor: page.hasMore && last ? encodeDebtCursor(last, filters) : null,
    };
  }

  async get(ownerId: string, debtId: string): Promise<PublicDebt> {
    const existing = await this.store.getDebt(ownerId, debtId);
    if (!existing) throw this.debtNotFound();
    await this.refreshStatuses(ownerId);
    return toPublicDebt(
      (await this.store.getDebt(ownerId, debtId)) ?? existing,
    );
  }

  async create(
    ownerId: string,
    sessionId: string,
    rawInput: DebtWriteInput,
  ): Promise<PublicDebt> {
    const input = normalizeDebtInput(rawInput);
    this.validateDates(input);
    const debtId = randomUUID();
    const now = this.now();
    const today = await this.today(ownerId, now);
    await this.store.createDebt({
      ...input,
      debtId,
      now,
      ownerId,
      sessionId,
      today,
    });
    return this.get(ownerId, debtId);
  }

  async update(
    ownerId: string,
    sessionId: string,
    debtId: string,
    rawInput: DebtWriteInput,
  ): Promise<PublicDebt> {
    const input = normalizeDebtInput(rawInput);
    this.validateDates(input);
    const now = this.now();
    const today = await this.today(ownerId, now);
    try {
      const updated = await this.store.updateDebt({
        ...input,
        debtId,
        now,
        ownerId,
        sessionId,
        today,
      });
      if (!updated) throw this.debtNotFound();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'DEBT_ORIGINAL_BELOW_PAID'
      ) {
        throw new AppError({
          code: 'DEBT_ORIGINAL_BELOW_PAID',
          message:
            'The original amount cannot be lower than the recorded payment total.',
          statusCode: 409,
        });
      }
      throw error;
    }
    return this.get(ownerId, debtId);
  }

  async delete(
    ownerId: string,
    sessionId: string,
    debtId: string,
  ): Promise<void> {
    const deleted = await this.store.deleteDebt({
      debtId,
      now: this.now(),
      ownerId,
      sessionId,
    });
    if (!deleted) throw this.debtNotFound();
  }

  async changeStatus(
    ownerId: string,
    sessionId: string,
    debtId: string,
    action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume',
  ): Promise<PublicDebt> {
    const now = this.now();
    const today = await this.today(ownerId, now);
    try {
      const changed = await this.store.changeStatus({
        action,
        debtId,
        now,
        ownerId,
        sessionId,
        today,
      });
      if (!changed) throw this.debtNotFound();
    } catch (error) {
      if (error instanceof Error && error.message === 'DEBT_STATUS_CONFLICT') {
        throw new AppError({
          code: 'DEBT_STATUS_CONFLICT',
          message: 'That status change is not available for this record.',
          statusCode: 409,
        });
      }
      if (
        error instanceof Error &&
        error.message === 'DEBT_REOPEN_BALANCE_COMPLETE'
      ) {
        throw new AppError({
          code: 'DEBT_REOPEN_BALANCE_COMPLETE',
          message:
            'Recorded payments already cover the original amount. Correct a payment or increase the original amount before reopening.',
          statusCode: 409,
        });
      }
      throw error;
    }
    return this.get(ownerId, debtId);
  }

  async recordPayment(
    ownerId: string,
    sessionId: string,
    debtId: string,
    idempotencyKey: string,
    rawInput: DebtPaymentWriteInput,
  ): Promise<{ payment: PublicDebtPayment; replayed: boolean }> {
    const input = normalizePaymentInput(rawInput);
    const request = { ...input, debtId };
    const now = this.now();
    const today = await this.today(ownerId, now);
    let result;
    try {
      result = await this.store.recordPayment({
        ...input,
        debtId,
        idempotencyKey,
        now,
        ownerId,
        paymentId: randomUUID(),
        requestHash: hashRequest(request),
        sessionId,
        today,
      });
    } catch (error) {
      throw this.mapPaymentError(error);
    }
    if (result.mismatched) throw this.idempotencyConflict();
    const payment = await this.store.getPayment(ownerId, result.paymentId);
    if (!payment) {
      throw new AppError({
        code: 'DEBT_PAYMENT_REPLAY_UNAVAILABLE',
        message: 'That payment request has already been completed.',
        statusCode: 409,
      });
    }
    return { payment: toPublicPayment(payment), replayed: result.replayed };
  }

  async updatePayment(
    ownerId: string,
    sessionId: string,
    paymentId: string,
    rawInput: DebtPaymentWriteInput,
  ): Promise<PublicDebtPayment> {
    const input = normalizePaymentInput(rawInput);
    const now = this.now();
    const today = await this.today(ownerId, now);
    try {
      const updated = await this.store.updatePayment({
        ...input,
        now,
        ownerId,
        paymentId,
        sessionId,
        today,
      });
      if (!updated) throw this.paymentNotFound();
    } catch (error) {
      throw this.mapPaymentError(error);
    }
    const payment = await this.store.getPayment(ownerId, paymentId);
    if (!payment) throw this.paymentNotFound();
    return toPublicPayment(payment);
  }

  async deletePayment(
    ownerId: string,
    sessionId: string,
    paymentId: string,
  ): Promise<void> {
    const deleted = await this.store.deletePayment({
      now: this.now(),
      ownerId,
      paymentId,
      sessionId,
    });
    if (!deleted) throw this.paymentNotFound();
  }

  async listPayments(
    ownerId: string,
    debtId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<DebtPaymentListResponse> {
    await this.get(ownerId, debtId);
    const page = await this.store.listPayments(
      ownerId,
      debtId,
      decodePaymentCursor(cursor),
      limit,
    );
    const last = page.items.at(-1);
    return {
      items: page.items.map(toPublicPayment),
      nextCursor: page.hasMore && last ? encodePaymentCursor(last) : null,
    };
  }

  async getSummary(ownerId: string): Promise<DebtSummary> {
    await this.refreshStatuses(ownerId);
    return this.store.getSummary(ownerId);
  }

  async listUpcoming(
    ownerId: string,
    days: number,
    limit: number,
  ): Promise<DebtUpcomingResponse> {
    const now = this.now();
    const today = await this.today(ownerId, now);
    await this.store.refreshOverdueStatuses(ownerId, today, now);
    return this.store.listUpcoming(
      ownerId,
      today,
      dateAfter(today, days),
      limit,
    );
  }

  private validateDates(input: DebtWriteInput): void {
    if (input.dueDate && input.dueDate < input.startDate) {
      throw new AppError({
        code: 'DEBT_DATE_RANGE_INVALID',
        message: 'The due date cannot be before the start date.',
        statusCode: 400,
      });
    }
    if (input.nextPaymentDate && input.nextPaymentDate < input.startDate) {
      throw new AppError({
        code: 'DEBT_DATE_RANGE_INVALID',
        message: 'The next payment cannot be before the start date.',
        statusCode: 400,
      });
    }
    const installmentFields = [
      input.installmentAmount,
      input.installmentFrequency,
      input.nextPaymentDate,
    ];
    if (
      installmentFields.some((value) => value !== null) &&
      installmentFields.some((value) => value === null)
    ) {
      throw new AppError({
        code: 'DEBT_INSTALLMENT_INCOMPLETE',
        message:
          'Add the installment amount, frequency, and next payment date together.',
        statusCode: 400,
      });
    }
  }

  private async refreshStatuses(ownerId: string): Promise<void> {
    const now = this.now();
    await this.store.refreshOverdueStatuses(
      ownerId,
      await this.today(ownerId, now),
      now,
    );
  }

  private async today(ownerId: string, now: Date): Promise<string> {
    return currentDateInTimeZone(now, await this.store.getTimeZone(ownerId));
  }

  private mapPaymentError(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    if (error.message === 'DEBT_NOT_FOUND') return this.debtNotFound();
    if (error.message === 'DEBT_PAYMENT_STATUS_INVALID') {
      return new AppError({
        code: 'DEBT_PAYMENT_STATUS_INVALID',
        message: 'Resume or reopen this record before adding another payment.',
        statusCode: 409,
      });
    }
    if (error.message === 'DEBT_PAYMENT_EXCEEDS_REMAINING') {
      return new AppError({
        code: 'DEBT_PAYMENT_EXCEEDS_REMAINING',
        message:
          'This payment is larger than the remaining amount. Confirm the overpayment to continue.',
        statusCode: 409,
      });
    }
    return error;
  }

  private debtNotFound(): AppError {
    return new AppError({
      code: 'DEBT_NOT_FOUND',
      message: 'That loan or debt is no longer available.',
      statusCode: 404,
    });
  }

  private paymentNotFound(): AppError {
    return new AppError({
      code: 'DEBT_PAYMENT_NOT_FOUND',
      message: 'That payment is no longer available.',
      statusCode: 404,
    });
  }

  private idempotencyConflict(): AppError {
    return new AppError({
      code: 'DEBT_PAYMENT_IDEMPOTENCY_KEY_REUSED',
      message: 'Retry this payment with a fresh request.',
      statusCode: 409,
    });
  }
}
