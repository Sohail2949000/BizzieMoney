import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes';
import type { AuthServiceContract } from '../auth/types';
import { isCalendarDate } from './schedule';
import {
  billingFrequencies,
  subscriptionSorts,
  subscriptionStatuses,
  type SubscriptionServiceContract,
  type SubscriptionWriteInput,
} from './types';

const uuidSchema = z.uuid();
const idempotencySchema = z.uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.')
  .refine(isCalendarDate, 'Use a valid calendar date.');
const amountSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
    'Use a positive amount with no more than four decimal places.',
  )
  .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero.');
const nullableDateSchema = z
  .union([dateSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => value || null);
const nullableNotesSchema = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional()
  .transform((value) => value || null);

const subscriptionWriteSchema = z
  .object({
    amount: amountSchema,
    autoRenew: z.boolean().default(true),
    billingFrequency: z.enum(billingFrequencies),
    categoryId: uuidSchema,
    customIntervalDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .nullable()
      .optional()
      .default(null),
    endDate: nullableDateSchema,
    name: z.string().trim().min(1).max(160),
    nextPaymentDate: dateSchema,
    notes: nullableNotesSchema,
    reminderDays: z.number().int().min(0).max(365).default(3),
    startDate: nullableDateSchema,
  })
  .superRefine((value, context) => {
    if (
      value.billingFrequency === 'custom' &&
      value.customIntervalDays === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Choose the number of days in the custom interval.',
        path: ['customIntervalDays'],
      });
    }
    if (
      value.billingFrequency !== 'custom' &&
      value.customIntervalDays !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Custom interval days are only used for custom schedules.',
        path: ['customIntervalDays'],
      });
    }
  });

const listQuerySchema = z
  .object({
    categoryId: uuidSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(subscriptionSorts).default('next_asc'),
    status: z.enum(subscriptionStatuses).optional(),
  })
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        message: 'The start date must be on or before the end date.',
        path: ['dateFrom'],
      });
    }
  });
const paymentListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const recordPaymentSchema = z.object({
  amount: amountSchema.nullable().optional().default(null),
  paidDate: dateSchema,
});
const convertSchema = z.object({ paymentMethodId: uuidSchema });

function parseSubscriptionWrite(input: unknown): SubscriptionWriteInput {
  const parsed = subscriptionWriteSchema.parse(input);
  return {
    ...parsed,
    customIntervalDays: parsed.customIntervalDays ?? null,
    endDate: parsed.endDate ?? null,
    notes: parsed.notes ?? null,
    startDate: parsed.startDate ?? null,
  };
}

function parseRecordPayment(input: unknown): {
  amount: string | null;
  paidDate: string;
} {
  const parsed = recordPaymentSchema.parse(input);
  return {
    ...parsed,
    amount: parsed.amount ?? null,
  };
}

export function registerSubscriptionRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: SubscriptionServiceContract;
  },
): void {
  server.get('/api/subscriptions/upcoming', async (request) => {
    const session = await requireSession(request, authService);
    const query = upcomingQuerySchema.parse(request.query);
    return service.listUpcoming(session.ownerId, query.days, query.limit);
  });

  server.get('/api/subscription-reminders', async (request) => {
    const session = await requireSession(request, authService);
    return service.listReminders(session.ownerId);
  });

  server.delete(
    '/api/subscription-reminders/:reminderId',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { reminderId } = z
        .object({ reminderId: uuidSchema })
        .parse(request.params);
      await service.dismissReminder(session.ownerId, reminderId);
      return reply.code(204).send();
    },
  );

  server.get('/api/subscriptions', async (request) => {
    const session = await requireSession(request, authService);
    return service.list(session.ownerId, listQuerySchema.parse(request.query));
  });

  server.post('/api/subscriptions', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return reply
      .code(201)
      .send(
        await service.create(
          session.ownerId,
          session.id,
          parseSubscriptionWrite(request.body),
        ),
      );
  });

  server.get('/api/subscriptions/:subscriptionId', async (request) => {
    const session = await requireSession(request, authService);
    const { subscriptionId } = z
      .object({ subscriptionId: uuidSchema })
      .parse(request.params);
    return service.get(session.ownerId, subscriptionId);
  });

  server.patch('/api/subscriptions/:subscriptionId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { subscriptionId } = z
      .object({ subscriptionId: uuidSchema })
      .parse(request.params);
    return service.update(
      session.ownerId,
      session.id,
      subscriptionId,
      parseSubscriptionWrite(request.body),
    );
  });

  server.delete(
    '/api/subscriptions/:subscriptionId',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { subscriptionId } = z
        .object({ subscriptionId: uuidSchema })
        .parse(request.params);
      await service.delete(session.ownerId, session.id, subscriptionId);
      return reply.code(204).send();
    },
  );

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    server.post(
      `/api/subscriptions/:subscriptionId/${action}`,
      async (request) => {
        const session = await requireSession(request, authService);
        requireCsrf(request, session, authService);
        const { subscriptionId } = z
          .object({ subscriptionId: uuidSchema })
          .parse(request.params);
        return service[action](session.ownerId, session.id, subscriptionId);
      },
    );
  }

  server.get('/api/subscriptions/:subscriptionId/payments', async (request) => {
    const session = await requireSession(request, authService);
    const { subscriptionId } = z
      .object({ subscriptionId: uuidSchema })
      .parse(request.params);
    const query = paymentListQuerySchema.parse(request.query);
    return service.listPayments(
      session.ownerId,
      subscriptionId,
      query.cursor,
      query.limit,
    );
  });

  server.post(
    '/api/subscriptions/:subscriptionId/payments',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { subscriptionId } = z
        .object({ subscriptionId: uuidSchema })
        .parse(request.params);
      const idempotencyKey = idempotencySchema.parse(
        request.headers['idempotency-key'],
      );
      const result = await service.recordPayment(
        session.ownerId,
        session.id,
        subscriptionId,
        idempotencyKey,
        parseRecordPayment(request.body),
      );
      if (result.replayed) {
        void reply.header('idempotency-replayed', 'true');
      }
      return reply.code(result.replayed ? 200 : 201).send(result.payment);
    },
  );

  server.post(
    '/api/subscription-payments/:paymentId/convert',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { paymentId } = z
        .object({ paymentId: uuidSchema })
        .parse(request.params);
      const idempotencyKey = idempotencySchema.parse(
        request.headers['idempotency-key'],
      );
      const input = convertSchema.parse(request.body);
      const result = await service.convertPaymentToExpense(
        session.ownerId,
        session.id,
        paymentId,
        idempotencyKey,
        input.paymentMethodId,
      );
      if (result.replayed) {
        void reply.header('idempotency-replayed', 'true');
      }
      return reply.code(result.replayed ? 200 : 201).send({
        expenseId: result.expenseId,
      });
    },
  );
}
