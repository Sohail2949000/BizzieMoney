import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes.js';
import type { AuthServiceContract } from '../auth/types.js';
import type { ExpenseServiceContract, ExpenseWriteInput } from './types.js';

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
const amountSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
    'Use a positive amount with no more than four decimal places.',
  )
  .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero.');
const nullableText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value || null);

const expenseWriteSchema = z.object({
  amount: amountSchema,
  categoryId: uuidSchema,
  date: dateSchema,
  description: z.string().trim().min(1).max(160),
  merchant: nullableText(120),
  notes: nullableText(5000),
  paymentMethodId: uuidSchema.nullable().optional().default(null),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(10)
    .optional()
    .default([]),
});

const listQueryBaseSchema = z.object({
  categoryId: uuidSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  hasAttachments: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  sort: z
    .enum([
      'date_desc',
      'date_asc',
      'amount_desc',
      'amount_asc',
      'updated_desc',
    ])
    .default('date_desc'),
});
const dateRangeRefinement = (
  value: { dateFrom?: string | undefined; dateTo?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom',
      message: 'The start date must be before the end date.',
      path: ['dateFrom'],
    });
  }
};
const listQuerySchema = listQueryBaseSchema.superRefine(dateRangeRefinement);
const exportQuerySchema = listQueryBaseSchema
  .omit({ cursor: true, limit: true })
  .superRefine(dateRangeRefinement);
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a valid month.');
const includeArchivedSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');
const optionNameSchema = z.string().trim().min(1).max(60);
const iconSchema = z.enum([
  'banknote',
  'car',
  'circle-ellipsis',
  'credit-card',
  'graduation-cap',
  'heart-pulse',
  'house',
  'landmark',
  'receipt',
  'shopping-bag',
  'smartphone',
  'ticket',
  'utensils',
  'wallet-cards',
]);
const colorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .transform((value) => value.toUpperCase());
const categoryCreateSchema = z.object({
  color: colorSchema,
  icon: iconSchema,
  name: optionNameSchema,
});
const categoryUpdateSchema = z
  .object({
    archived: z.boolean().optional(),
    color: colorSchema.optional(),
    icon: iconSchema.optional(),
    name: optionNameSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Choose at least one category change.',
  });
const categoryDeleteSchema = z.object({
  replacementCategoryId: uuidSchema,
});
const paymentCreateSchema = z.object({
  icon: iconSchema,
  name: optionNameSchema,
});
const paymentUpdateSchema = z
  .object({
    archived: z.boolean().optional(),
    icon: iconSchema.optional(),
    name: optionNameSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Choose at least one payment method change.',
  });
const importBodySchema = z.object({
  csvText: z.string().min(1).max(2_000_000),
});

function parseExpenseWrite(input: unknown): ExpenseWriteInput {
  const parsed = expenseWriteSchema.parse(input);
  return {
    ...parsed,
    merchant: parsed.merchant ?? null,
    notes: parsed.notes ?? null,
    paymentMethodId: parsed.paymentMethodId ?? null,
    tags: parsed.tags ?? [],
  };
}

function parseCategoryCreate(input: unknown): {
  color: string;
  icon: string;
  name: string;
} {
  const parsed = categoryCreateSchema.parse(input);
  return {
    color: parsed.color,
    icon: parsed.icon,
    name: parsed.name,
  };
}

export function registerExpenseRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: ExpenseServiceContract;
  },
): void {
  server.get('/api/expense-options', async (request) => {
    const session = await requireSession(request, authService);
    const query = z
      .object({ includeArchived: includeArchivedSchema })
      .parse(request.query);
    return service.getOptions(session.ownerId, query.includeArchived);
  });

  server.post('/api/expense-categories', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const input = parseCategoryCreate(request.body);
    return reply
      .code(201)
      .send(await service.createCategory(session.ownerId, input));
  });

  server.patch('/api/expense-categories/:categoryId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { categoryId } = z
      .object({ categoryId: uuidSchema })
      .parse(request.params);
    return service.updateCategory(
      session.ownerId,
      categoryId,
      categoryUpdateSchema.parse(request.body),
    );
  });

  server.get(
    '/api/expense-categories/:categoryId/deletion-preview',
    async (request) => {
      const session = await requireSession(request, authService);
      const { categoryId } = z
        .object({ categoryId: uuidSchema })
        .parse(request.params);
      return service.getCategoryDeletionPreview(session.ownerId, categoryId);
    },
  );

  server.delete('/api/expense-categories/:categoryId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { categoryId } = z
      .object({ categoryId: uuidSchema })
      .parse(request.params);
    const { replacementCategoryId } = categoryDeleteSchema.parse(request.body);
    return service.deleteCategory(
      session.ownerId,
      session.id,
      categoryId,
      replacementCategoryId,
    );
  });

  server.post('/api/payment-methods', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const input = paymentCreateSchema.parse(request.body);
    return reply
      .code(201)
      .send(await service.createPaymentMethod(session.ownerId, input));
  });

  server.patch('/api/payment-methods/:paymentMethodId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { paymentMethodId } = z
      .object({ paymentMethodId: uuidSchema })
      .parse(request.params);
    return service.updatePaymentMethod(
      session.ownerId,
      paymentMethodId,
      paymentUpdateSchema.parse(request.body),
    );
  });

  server.get('/api/expenses/summary', async (request) => {
    const session = await requireSession(request, authService);
    const { month } = z.object({ month: monthSchema }).parse(request.query);
    return service.getSummary(session.ownerId, month);
  });

  server.get('/api/expenses/export.csv', async (request, reply) => {
    const session = await requireSession(request, authService);
    const filters = exportQuerySchema.parse(request.query);
    const filenameDate = new Date().toISOString().slice(0, 10);
    void reply
      .header(
        'content-disposition',
        `attachment; filename="bizziemoney-expenses-${filenameDate}.csv"`,
      )
      .type('text/csv; charset=utf-8');
    return reply.send(
      Readable.from(service.exportExpenses(session.ownerId, filters)),
    );
  });

  server.post('/api/expenses/import/preview', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { csvText } = importBodySchema.parse(request.body);
    return service.previewImport(session.ownerId, csvText);
  });

  server.post('/api/expenses/import', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const idempotencyKey = z
      .string()
      .uuid()
      .parse(request.headers['idempotency-key']);
    const { csvText } = importBodySchema.parse(request.body);
    const result = await service.importExpenses(
      session.ownerId,
      session.id,
      idempotencyKey,
      csvText,
    );
    if (result.replayed) {
      void reply.header('idempotency-replayed', 'true');
    }
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  server.get('/api/expenses', async (request) => {
    const session = await requireSession(request, authService);
    return service.listExpenses(
      session.ownerId,
      listQuerySchema.parse(request.query),
    );
  });

  server.get('/api/expenses/:expenseId', async (request) => {
    const session = await requireSession(request, authService);
    const { expenseId } = z
      .object({ expenseId: uuidSchema })
      .parse(request.params);
    return service.getExpense(session.ownerId, expenseId);
  });

  server.post('/api/expenses', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const idempotencyKey = z
      .string()
      .uuid()
      .parse(request.headers['idempotency-key']);
    const result = await service.createExpense(
      session.ownerId,
      session.id,
      idempotencyKey,
      parseExpenseWrite(request.body),
    );
    if (result.replayed) {
      void reply.header('idempotency-replayed', 'true');
    }
    return reply.code(result.replayed ? 200 : 201).send(result.expense);
  });

  server.patch('/api/expenses/:expenseId', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { expenseId } = z
      .object({ expenseId: uuidSchema })
      .parse(request.params);
    return service.updateExpense(
      session.ownerId,
      session.id,
      expenseId,
      parseExpenseWrite(request.body),
    );
  });

  server.delete('/api/expenses/:expenseId', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { expenseId } = z
      .object({ expenseId: uuidSchema })
      .parse(request.params);
    await service.deleteExpense(session.ownerId, session.id, expenseId);
    return reply.code(204).send();
  });
}
