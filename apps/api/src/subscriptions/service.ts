import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { currentDateInTimeZone } from '@bizziemoney/shared';

import { AppError } from '../errors.js';
import { dateAfter } from './schedule.js';
import { subscriptionCursorValue } from './store.js';
import type { PostgresSubscriptionStore, SubscriptionStore } from './store.js';
import type {
  PublicSubscription,
  PublicSubscriptionPayment,
  SubscriptionFilters,
  SubscriptionListResponse,
  SubscriptionPaymentListResponse,
  SubscriptionPaymentRecord,
  SubscriptionRecord,
  SubscriptionReminder,
  SubscriptionServiceContract,
  SubscriptionSort,
  SubscriptionStatus,
  SubscriptionUpcomingResponse,
  SubscriptionWriteInput,
} from './types.js';

const subscriptionCursorSchema = z.object({
  id: z.uuid(),
  sort: z.enum(['next_asc', 'next_desc', 'amount_desc', 'updated_desc']),
  value: z.string().min(1).max(64),
  version: z.literal(1),
});

const paymentCursorSchema = z.object({
  id: z.uuid(),
  paidDate: z.string(),
  type: z.literal('subscription-payment'),
  version: z.literal(1),
});

function toPublicSubscription(
  subscription: SubscriptionRecord,
): PublicSubscription {
  return {
    ...subscription,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

function toPublicPayment(
  payment: SubscriptionPaymentRecord,
): PublicSubscriptionPayment {
  return {
    ...payment,
    createdAt: payment.createdAt.toISOString(),
  };
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function normalizeInput(input: SubscriptionWriteInput): SubscriptionWriteInput {
  return {
    ...input,
    amount: input.amount.trim(),
    customIntervalDays:
      input.billingFrequency === 'custom' ? input.customIntervalDays : null,
    endDate: input.endDate || null,
    name: input.name.trim(),
    notes: input.notes?.trim() || null,
    startDate: input.startDate || null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

function encodeSubscriptionCursor(
  subscription: SubscriptionRecord,
  filters: SubscriptionFilters,
): string {
  return Buffer.from(
    JSON.stringify({
      id: subscription.id,
      sort: filters.sort,
      value: subscriptionCursorValue(subscription, filters.sort),
      version: 1,
    }),
  ).toString('base64url');
}

function decodeSubscriptionCursor(
  cursor: string | undefined,
  sort: SubscriptionSort,
): { id: string; value: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = subscriptionCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.sort !== sort) throw new Error('sort mismatch');
    return { id: parsed.id, value: parsed.value };
  } catch {
    throw new AppError({
      code: 'CURSOR_INVALID',
      message: 'That subscription page link is no longer valid.',
      statusCode: 400,
    });
  }
}

function encodePaymentCursor(payment: {
  id: string;
  paidDate: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      id: payment.id,
      paidDate: payment.paidDate,
      type: 'subscription-payment',
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
    return { id: parsed.id, value: parsed.paidDate };
  } catch {
    throw new AppError({
      code: 'CURSOR_INVALID',
      message: 'That payment-history page link is no longer valid.',
      statusCode: 400,
    });
  }
}

export class SubscriptionService implements SubscriptionServiceContract {
  constructor(
    private readonly store: SubscriptionStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static fromPostgres(store: PostgresSubscriptionStore): SubscriptionService {
    return new SubscriptionService(store);
  }

  async list(
    ownerId: string,
    input: {
      categoryId?: string | undefined;
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      limit: number;
      search?: string | undefined;
      sort: SubscriptionSort;
      status?: SubscriptionStatus | undefined;
    },
  ): Promise<SubscriptionListResponse> {
    const filters: SubscriptionFilters = {
      categoryId: input.categoryId,
      cursor: decodeSubscriptionCursor(input.cursor, input.sort),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      limit: input.limit,
      search: input.search?.trim() || undefined,
      sort: input.sort,
      status: input.status,
    };
    const page = await this.store.listSubscriptions(ownerId, filters);
    const last = page.items.at(-1);
    return {
      items: page.items.map(toPublicSubscription),
      nextCursor:
        page.hasMore && last ? encodeSubscriptionCursor(last, filters) : null,
    };
  }

  async get(
    ownerId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription> {
    const subscription = await this.store.getSubscription(
      ownerId,
      subscriptionId,
    );
    if (!subscription) throw this.subscriptionNotFound();
    return toPublicSubscription(subscription);
  }

  async create(
    ownerId: string,
    sessionId: string,
    rawInput: SubscriptionWriteInput,
  ): Promise<PublicSubscription> {
    const input = normalizeInput(rawInput);
    this.validateDateRange(input);
    const subscriptionId = randomUUID();
    const created = await this.store.createSubscription({
      ...input,
      now: this.now(),
      ownerId,
      sessionId,
      subscriptionId,
    });
    if (!created) throw this.categoryUnavailable();
    return this.get(ownerId, subscriptionId);
  }

  async update(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
    rawInput: SubscriptionWriteInput,
  ): Promise<PublicSubscription> {
    const input = normalizeInput(rawInput);
    this.validateDateRange(input);
    const updated = await this.store.updateSubscription({
      ...input,
      now: this.now(),
      ownerId,
      sessionId,
      subscriptionId,
    });
    if (!updated) throw this.subscriptionNotFound();
    return this.get(ownerId, subscriptionId);
  }

  async pause(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription> {
    return this.changeStatus(ownerId, sessionId, subscriptionId, 'pause');
  }

  async resume(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription> {
    return this.changeStatus(ownerId, sessionId, subscriptionId, 'resume');
  }

  async cancel(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription> {
    return this.changeStatus(ownerId, sessionId, subscriptionId, 'cancel');
  }

  async delete(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<void> {
    const deleted = await this.store.deleteSubscription({
      now: this.now(),
      ownerId,
      sessionId,
      subscriptionId,
    });
    if (!deleted) throw this.subscriptionNotFound();
  }

  async recordPayment(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
    idempotencyKey: string,
    input: { amount: string | null; paidDate: string },
  ): Promise<{ payment: PublicSubscriptionPayment; replayed: boolean }> {
    const normalized = {
      amount: input.amount?.trim() || null,
      paidDate: input.paidDate,
      subscriptionId,
    };
    let result;
    try {
      result = await this.store.recordPayment({
        ...normalized,
        idempotencyKey,
        now: this.now(),
        ownerId,
        paymentId: randomUUID(),
        requestHash: hashRequest(normalized),
        sessionId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: 'SUBSCRIPTION_PAYMENT_ALREADY_RECORDED',
          message: 'A payment has already been recorded for this due date.',
          statusCode: 409,
        });
      }
      if (
        error instanceof Error &&
        error.message === 'SUBSCRIPTION_PAYMENT_STATUS_INVALID'
      ) {
        throw new AppError({
          code: 'SUBSCRIPTION_PAYMENT_STATUS_INVALID',
          message: 'Resume this subscription before recording its payment.',
          statusCode: 409,
        });
      }
      if (
        error instanceof Error &&
        error.message === 'SUBSCRIPTION_NOT_FOUND'
      ) {
        throw this.subscriptionNotFound();
      }
      throw error;
    }
    if (result.mismatched) throw this.idempotencyConflict();
    const payment = await this.store.getPayment(ownerId, result.paymentId);
    if (!payment) {
      throw new AppError({
        code: 'SUBSCRIPTION_PAYMENT_REPLAY_UNAVAILABLE',
        message: 'That payment request has already been completed.',
        statusCode: 409,
      });
    }
    return {
      payment: toPublicPayment(payment),
      replayed: result.replayed,
    };
  }

  async listPayments(
    ownerId: string,
    subscriptionId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<SubscriptionPaymentListResponse> {
    await this.get(ownerId, subscriptionId);
    const page = await this.store.listPayments(
      ownerId,
      subscriptionId,
      decodePaymentCursor(cursor),
      limit,
    );
    const last = page.items.at(-1);
    return {
      items: page.items.map(toPublicPayment),
      nextCursor: page.hasMore && last ? encodePaymentCursor(last) : null,
    };
  }

  async convertPaymentToExpense(
    ownerId: string,
    sessionId: string,
    paymentId: string,
    idempotencyKey: string,
    paymentMethodId: string,
  ): Promise<{ expenseId: string; replayed: boolean }> {
    const request = { paymentId, paymentMethodId };
    let result;
    try {
      result = await this.store.convertPayment({
        expenseId: randomUUID(),
        idempotencyKey,
        now: this.now(),
        ownerId,
        paymentId,
        paymentMethodId,
        requestHash: hashRequest(request),
        sessionId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'SUBSCRIPTION_PAYMENT_NOT_FOUND'
      ) {
        throw this.paymentNotFound();
      }
      if (
        error instanceof Error &&
        error.message === 'SUBSCRIPTION_PAYMENT_ALREADY_CONVERTED'
      ) {
        throw new AppError({
          code: 'SUBSCRIPTION_PAYMENT_ALREADY_CONVERTED',
          message: 'This payment is already linked to an expense.',
          statusCode: 409,
        });
      }
      if (
        error instanceof Error &&
        error.message === 'PAYMENT_METHOD_NOT_FOUND'
      ) {
        throw new AppError({
          code: 'PAYMENT_METHOD_NOT_FOUND',
          message: 'Choose an active payment method.',
          statusCode: 404,
        });
      }
      throw error;
    }
    if (result.mismatched) throw this.idempotencyConflict();
    return { expenseId: result.expenseId, replayed: result.replayed };
  }

  async listUpcoming(
    ownerId: string,
    days: number,
    limit: number,
  ): Promise<SubscriptionUpcomingResponse> {
    const [timeZone, now] = await Promise.all([
      this.store.getTimeZone(ownerId),
      Promise.resolve(this.now()),
    ]);
    const today = currentDateInTimeZone(now, timeZone);
    return this.store.listUpcoming(
      ownerId,
      today,
      dateAfter(today, days),
      limit,
    );
  }

  async listReminders(ownerId: string): Promise<SubscriptionReminder[]> {
    return this.store.listReminders(ownerId);
  }

  async dismissReminder(ownerId: string, reminderId: string): Promise<void> {
    const dismissed = await this.store.dismissReminder(
      ownerId,
      reminderId,
      this.now(),
    );
    if (!dismissed) {
      throw new AppError({
        code: 'SUBSCRIPTION_REMINDER_NOT_FOUND',
        message: 'That reminder is no longer available.',
        statusCode: 404,
      });
    }
  }

  private async changeStatus(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
    action: 'cancel' | 'pause' | 'resume',
  ): Promise<PublicSubscription> {
    const current = await this.store.getSubscription(ownerId, subscriptionId);
    if (!current) throw this.subscriptionNotFound();
    const valid =
      (action === 'pause' && current.status === 'active') ||
      (action === 'resume' && current.status === 'paused') ||
      (action === 'cancel' && ['active', 'paused'].includes(current.status));
    if (!valid) {
      const actionLabel = {
        cancel: 'cancelled',
        pause: 'paused',
        resume: 'resumed',
      }[action];
      throw new AppError({
        code: 'SUBSCRIPTION_STATUS_CONFLICT',
        message: `This subscription cannot be ${actionLabel} from its current status.`,
        statusCode: 409,
      });
    }
    const changed = await this.store.changeStatus({
      action,
      now: this.now(),
      ownerId,
      sessionId,
      subscriptionId,
    });
    if (!changed) {
      throw new AppError({
        code: 'SUBSCRIPTION_STATUS_CONFLICT',
        message: 'The subscription changed before this action completed.',
        statusCode: 409,
      });
    }
    return this.get(ownerId, subscriptionId);
  }

  private validateDateRange(input: SubscriptionWriteInput): void {
    if (input.startDate && input.nextPaymentDate < input.startDate) {
      throw new AppError({
        code: 'SUBSCRIPTION_DATE_RANGE_INVALID',
        message: 'The next payment cannot be before the start date.',
        statusCode: 400,
      });
    }
    if (input.endDate && input.startDate && input.endDate < input.startDate) {
      throw new AppError({
        code: 'SUBSCRIPTION_DATE_RANGE_INVALID',
        message: 'The end date cannot be before the start date.',
        statusCode: 400,
      });
    }
    if (input.endDate && input.endDate < input.nextPaymentDate) {
      throw new AppError({
        code: 'SUBSCRIPTION_DATE_RANGE_INVALID',
        message: 'The end date cannot be before the next payment.',
        statusCode: 400,
      });
    }
  }

  private categoryUnavailable(): AppError {
    return new AppError({
      code: 'CATEGORY_NOT_FOUND',
      message: 'Choose an active category.',
      statusCode: 404,
    });
  }

  private idempotencyConflict(): AppError {
    return new AppError({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Retry this action with a fresh request.',
      statusCode: 409,
    });
  }

  private paymentNotFound(): AppError {
    return new AppError({
      code: 'SUBSCRIPTION_PAYMENT_NOT_FOUND',
      message: 'That subscription payment is no longer available.',
      statusCode: 404,
    });
  }

  private subscriptionNotFound(): AppError {
    return new AppError({
      code: 'SUBSCRIPTION_NOT_FOUND',
      message: 'That subscription is no longer available.',
      statusCode: 404,
    });
  }
}
