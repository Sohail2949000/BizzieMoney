import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes';
import type { AuthServiceContract } from '../auth/types';
import {
  debtDirections,
  debtFrequencies,
  debtSorts,
  debtStatuses,
  type DebtServiceContract,
} from './types';

const uuidSchema = z.uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.')
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Use a valid calendar date.');
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
const nullableAmountSchema = z
  .union([amountSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => value || null);
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);

const debtWriteSchema = z
  .object({
    customIntervalDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .nullable()
      .optional()
      .default(null),
    direction: z.enum(debtDirections),
    dueDate: nullableDateSchema,
    installmentAmount: nullableAmountSchema,
    installmentFrequency: z
      .enum(debtFrequencies)
      .nullable()
      .optional()
      .default(null),
    interestNote: nullableText(1000),
    name: z.string().trim().min(1).max(160),
    nextPaymentDate: nullableDateSchema,
    notes: nullableText(5000),
    originalAmount: amountSchema,
    startDate: dateSchema,
  })
  .superRefine((value, context) => {
    if (value.dueDate && value.dueDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'The due date cannot be before the start date.',
        path: ['dueDate'],
      });
    }
    if (value.nextPaymentDate && value.nextPaymentDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'The next payment cannot be before the start date.',
        path: ['nextPaymentDate'],
      });
    }
    const installmentValues = [
      value.installmentAmount,
      value.installmentFrequency,
      value.nextPaymentDate,
    ];
    if (
      installmentValues.some((item) => item !== null) &&
      installmentValues.some((item) => item === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Add the amount, frequency, and next date for an installment plan.',
        path: ['installmentAmount'],
      });
    }
    if (
      value.installmentFrequency === 'custom' &&
      value.customIntervalDays === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Add the number of days in the custom interval.',
        path: ['customIntervalDays'],
      });
    }
    if (
      value.installmentFrequency !== 'custom' &&
      value.customIntervalDays !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Custom days are only used for custom installments.',
        path: ['customIntervalDays'],
      });
    }
  });

const paymentWriteSchema = z.object({
  allowOverpayment: z.boolean().optional().default(false),
  amount: amountSchema,
  notes: nullableText(1000),
  paymentDate: dateSchema,
});
const listQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    direction: z.enum(debtDirections).default('i_owe'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(debtSorts).default('due_asc'),
    status: z.enum(debtStatuses).optional(),
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

export function registerDebtRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: DebtServiceContract;
  },
): void {
  server.get('/api/debts/summary', async (request) => {
    const session = await requireSession(request, authService);
    return service.getSummary(session.ownerId);
  });

  server.get('/api/debts/upcoming', async (request) => {
    const session = await requireSession(request, authService);
    const query = upcomingQuerySchema.parse(request.query);
    return service.listUpcoming(session.ownerId, query.days, query.limit);
  });

  server.get('/api/debts', async (request) => {
    const session = await requireSession(request, authService);
    return service.list(session.ownerId, listQuerySchema.parse(request.query));
  });

  server.post('/api/debts', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return reply
      .code(201)
      .send(
        await service.create(
          session.ownerId,
          session.id,
          debtWriteSchema.parse(request.body),
        ),
      );
  });

  server.get('/api/debts/:debtId', async (request) => {
    const session = await requireSession(request, authService);
    const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
    return service.get(session.ownerId, debtId);
  });

  server.patch('/api/debts/:debtId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
    return service.update(
      session.ownerId,
      session.id,
      debtId,
      debtWriteSchema.parse(request.body),
    );
  });

  server.delete('/api/debts/:debtId', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
    await service.delete(session.ownerId, session.id, debtId);
    return reply.code(204).send();
  });

  for (const action of [
    'pause',
    'resume',
    'cancel',
    'complete',
    'reopen',
  ] as const) {
    server.post(`/api/debts/:debtId/${action}`, async (request) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
      return service.changeStatus(session.ownerId, session.id, debtId, action);
    });
  }

  server.get('/api/debts/:debtId/payments', async (request) => {
    const session = await requireSession(request, authService);
    const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
    const query = paymentListQuerySchema.parse(request.query);
    return service.listPayments(
      session.ownerId,
      debtId,
      query.cursor,
      query.limit,
    );
  });

  server.post('/api/debts/:debtId/payments', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { debtId } = z.object({ debtId: uuidSchema }).parse(request.params);
    const idempotencyKey = z.uuid().parse(request.headers['idempotency-key']);
    const result = await service.recordPayment(
      session.ownerId,
      session.id,
      debtId,
      idempotencyKey,
      paymentWriteSchema.parse(request.body),
    );
    if (result.replayed) {
      void reply.header('idempotency-replayed', 'true');
    }
    return reply.code(result.replayed ? 200 : 201).send(result.payment);
  });

  server.patch('/api/debt-payments/:paymentId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { paymentId } = z
      .object({ paymentId: uuidSchema })
      .parse(request.params);
    return service.updatePayment(
      session.ownerId,
      session.id,
      paymentId,
      paymentWriteSchema.parse(request.body),
    );
  });

  server.delete('/api/debt-payments/:paymentId', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { paymentId } = z
      .object({ paymentId: uuidSchema })
      .parse(request.params);
    await service.deletePayment(session.ownerId, session.id, paymentId);
    return reply.code(204).send();
  });
}
