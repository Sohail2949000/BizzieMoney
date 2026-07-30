import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes.js';
import type { AuthServiceContract } from '../auth/types.js';
import { AppError } from '../errors.js';
import type {
  AttachmentServiceContract,
  AttachmentStorageConfigInput,
} from './types.js';

const idParamsSchema = z.object({ attachmentId: z.uuid() });
const expenseParamsSchema = z.object({ expenseId: z.uuid() });
const subscriptionParamsSchema = z.object({ subscriptionId: z.uuid() });
const debtParamsSchema = z.object({ debtId: z.uuid() });
const debtPaymentParamsSchema = z.object({ paymentId: z.uuid() });
const contentQuerySchema = z.object({
  disposition: z.enum(['attachment', 'inline']).default('inline'),
});
const endpointSchema = z
  .union([z.string().trim().max(2048), z.null()])
  .default(null)
  .transform((value, context) => {
    if (!value) return null;
    try {
      const endpoint = new URL(value);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (endpoint.pathname !== '' && endpoint.pathname !== '/')
      ) {
        throw new Error('invalid');
      }
      return endpoint.origin;
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Enter an HTTP or HTTPS endpoint without a path.',
      });
      return z.NEVER;
    }
  });
const storageS3Schema = z.object({
  accessKeyId: z.string().trim().max(512).optional(),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/,
      'Enter a valid bucket name.',
    ),
  endpoint: endpointSchema,
  forcePathStyle: z.boolean().default(false),
  prefix: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
    .refine(
      (value) => !value.split('/').includes('..'),
      'Do not use parent folders in the prefix.',
    ),
  region: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-]+$/, 'Enter a valid region.'),
  removeCredentials: z.boolean().optional(),
  secretAccessKey: z.string().trim().max(512).optional(),
});
const storageConfigSchema = z
  .object({
    provider: z.enum(['local', 's3']),
    s3: storageS3Schema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.provider === 's3' && !value.s3) {
      context.addIssue({
        code: 'custom',
        message: 'Enter the S3-compatible storage details.',
        path: ['s3'],
      });
    }
  });

function parseStorageConfig(input: unknown): AttachmentStorageConfigInput {
  const parsed = storageConfigSchema.parse(input);
  return {
    provider: parsed.provider,
    s3: parsed.s3
      ? {
          ...parsed.s3,
          endpoint: parsed.s3.endpoint ?? null,
        }
      : null,
  };
}

function contentDisposition(
  disposition: 'attachment' | 'inline',
  displayName: string,
): string {
  const asciiName = displayName
    .replace(/[^\x20-\x7e]/g, '_')
    .replaceAll('"', '_');
  return `${disposition}; filename="${asciiName}"`;
}

export function registerAttachmentRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: AttachmentServiceContract;
  },
): void {
  server.get('/api/attachment-storage', async (request) => {
    const session = await requireSession(request, authService);
    return service.getStorageStatus(session.ownerId);
  });

  server.post('/api/attachment-storage/test', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return reply.send(
      await service.testStorage(
        session.ownerId,
        parseStorageConfig(request.body),
      ),
    );
  });

  server.patch('/api/attachment-storage', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return {
      configuration: await service.saveStorageConfig(
        session.ownerId,
        session.id,
        parseStorageConfig(request.body),
      ),
    };
  });

  server.get('/api/expenses/:expenseId/attachments', async (request) => {
    const session = await requireSession(request, authService);
    const { expenseId } = expenseParamsSchema.parse(request.params);
    return service.listExpenseAttachments(session.ownerId, expenseId);
  });

  server.post(
    '/api/expenses/:expenseId/attachments',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { expenseId } = expenseParamsSchema.parse(request.params);
      const idempotencyKey = z.uuid().parse(request.headers['idempotency-key']);
      const part = await request.file();
      if (!part) {
        throw new AppError({
          code: 'ATTACHMENT_REQUIRED',
          message: 'Choose a file to upload.',
          statusCode: 400,
        });
      }
      const result = await service.uploadExpenseAttachment({
        declaredMimeType: part.mimetype,
        entityId: expenseId,
        entityType: 'expense',
        fileName: part.filename,
        idempotencyKey,
        ownerId: session.ownerId,
        sessionId: session.id,
        stream: part.file,
      });
      return reply.code(result.replayed ? 200 : 201).send(result.attachment);
    },
  );

  server.get(
    '/api/subscriptions/:subscriptionId/attachments',
    async (request) => {
      const session = await requireSession(request, authService);
      const { subscriptionId } = subscriptionParamsSchema.parse(request.params);
      return service.listSubscriptionAttachments(
        session.ownerId,
        subscriptionId,
      );
    },
  );

  server.post(
    '/api/subscriptions/:subscriptionId/attachments',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { subscriptionId } = subscriptionParamsSchema.parse(request.params);
      const idempotencyKey = z.uuid().parse(request.headers['idempotency-key']);
      const part = await request.file();
      if (!part) {
        throw new AppError({
          code: 'ATTACHMENT_REQUIRED',
          message: 'Choose a file to upload.',
          statusCode: 400,
        });
      }
      const result = await service.uploadSubscriptionAttachment({
        declaredMimeType: part.mimetype,
        entityId: subscriptionId,
        entityType: 'subscription',
        fileName: part.filename,
        idempotencyKey,
        ownerId: session.ownerId,
        sessionId: session.id,
        stream: part.file,
      });
      return reply.code(result.replayed ? 200 : 201).send(result.attachment);
    },
  );

  server.get('/api/debts/:debtId/attachments', async (request) => {
    const session = await requireSession(request, authService);
    const { debtId } = debtParamsSchema.parse(request.params);
    return service.listDebtAttachments(session.ownerId, debtId);
  });

  server.post('/api/debts/:debtId/attachments', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { debtId } = debtParamsSchema.parse(request.params);
    const idempotencyKey = z.uuid().parse(request.headers['idempotency-key']);
    const part = await request.file();
    if (!part) {
      throw new AppError({
        code: 'ATTACHMENT_REQUIRED',
        message: 'Choose a file to upload.',
        statusCode: 400,
      });
    }
    const result = await service.uploadDebtAttachment({
      declaredMimeType: part.mimetype,
      entityId: debtId,
      entityType: 'debt',
      fileName: part.filename,
      idempotencyKey,
      ownerId: session.ownerId,
      sessionId: session.id,
      stream: part.file,
    });
    return reply.code(result.replayed ? 200 : 201).send(result.attachment);
  });

  server.get('/api/debt-payments/:paymentId/attachments', async (request) => {
    const session = await requireSession(request, authService);
    const { paymentId } = debtPaymentParamsSchema.parse(request.params);
    return service.listDebtPaymentAttachments(session.ownerId, paymentId);
  });

  server.post(
    '/api/debt-payments/:paymentId/attachments',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { paymentId } = debtPaymentParamsSchema.parse(request.params);
      const idempotencyKey = z.uuid().parse(request.headers['idempotency-key']);
      const part = await request.file();
      if (!part) {
        throw new AppError({
          code: 'ATTACHMENT_REQUIRED',
          message: 'Choose a file to upload.',
          statusCode: 400,
        });
      }
      const result = await service.uploadDebtPaymentAttachment({
        declaredMimeType: part.mimetype,
        entityId: paymentId,
        entityType: 'debt_payment',
        fileName: part.filename,
        idempotencyKey,
        ownerId: session.ownerId,
        sessionId: session.id,
        stream: part.file,
      });
      return reply.code(result.replayed ? 200 : 201).send(result.attachment);
    },
  );

  server.get(
    '/api/attachments/:attachmentId/content',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      const { attachmentId } = idParamsSchema.parse(request.params);
      const { disposition } = contentQuerySchema.parse(request.query);
      const content = await service.getContent(session.ownerId, attachmentId);
      void reply.header(
        'content-disposition',
        contentDisposition(disposition, content.attachment.displayName),
      );
      void reply.header(
        'content-length',
        String(
          content.object.contentLength ?? Number(content.attachment.sizeBytes),
        ),
      );
      void reply.header('x-content-type-options', 'nosniff');
      return reply.type(content.attachment.mimeType).send(content.object.body);
    },
  );

  server.get(
    '/api/attachments/:attachmentId/thumbnail',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      const { attachmentId } = idParamsSchema.parse(request.params);
      const content = await service.getThumbnail(session.ownerId, attachmentId);
      if (content.object.contentLength !== undefined) {
        void reply.header(
          'content-length',
          String(content.object.contentLength),
        );
      }
      void reply.header('cache-control', 'private, max-age=86400');
      void reply.header('x-content-type-options', 'nosniff');
      return reply.type('image/webp').send(content.object.body);
    },
  );

  server.delete('/api/attachments/:attachmentId', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const { attachmentId } = idParamsSchema.parse(request.params);
    await service.deleteAttachment(session.ownerId, session.id, attachmentId);
    return reply.code(204).send();
  });
}
