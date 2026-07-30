import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes';
import type { AuthServiceContract } from '../auth/types';
import type { BackupServiceContract } from './types';

const uuidSchema = z.uuid();
const nullableUrl = z
  .union([z.url().max(2048), z.literal(''), z.null()])
  .transform((value) => value || null);
const s3Schema = z.object({
  accessKeyId: z.string().trim().max(512).optional(),
  bucket: z.string().trim().min(3).max(255),
  endpoint: nullableUrl,
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
  region: z.string().trim().min(1).max(100),
  secretAccessKey: z.string().trim().max(512).optional(),
});
const configSchema = z
  .object({
    backupTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid backup time.'),
    dayOfMonth: z.number().int().min(1).max(28).nullable(),
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    destination: z.enum(['local', 's3']),
    enabled: z.boolean(),
    encryptionPassword: z
      .string()
      .min(12, 'Use at least 12 characters for backup encryption.')
      .max(128)
      .nullable()
      .optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    includeAttachments: z.boolean(),
    localSubfolder: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
        'Use letters, numbers, dashes, and underscores.',
      ),
    retentionCount: z.number().int().min(1).max(100),
    s3: s3Schema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.frequency === 'weekly' && value.dayOfWeek === null) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a weekday.',
        path: ['dayOfWeek'],
      });
    }
    if (value.frequency === 'monthly' && value.dayOfMonth === null) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a day of the month.',
        path: ['dayOfMonth'],
      });
    }
    if (value.destination === 's3' && value.s3 === null) {
      context.addIssue({
        code: 'custom',
        message: 'Enter the S3-compatible destination.',
        path: ['s3'],
      });
    }
  });

export function registerBackupRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: BackupServiceContract;
  },
): void {
  server.get('/api/backups/status', async (request) => {
    const session = await requireSession(request, authService);
    return service.getStatus(session.ownerId);
  });

  server.get('/api/backups/config', async (request) => {
    const session = await requireSession(request, authService);
    return { config: await service.getConfig(session.ownerId) };
  });

  server.patch('/api/backups/config', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return {
      config: await service.saveConfig(
        session.ownerId,
        configSchema.parse(request.body),
      ),
    };
  });

  server.post('/api/backups/test-destination', async (request) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    return service.testDestination(
      session.ownerId,
      configSchema.parse(request.body),
    );
  });

  server.get('/api/backups/history', async (request) => {
    const session = await requireSession(request, authService);
    return service.listHistory(session.ownerId);
  });

  server.post('/api/backups/run', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const idempotencyKey = uuidSchema.parse(request.headers['idempotency-key']);
    return reply
      .code(202)
      .send(await service.enqueueBackup(session.ownerId, idempotencyKey));
  });

  server.post(
    '/api/backups/artifacts/:artifactId/preview',
    async (request, reply) => {
      const session = await requireSession(request, authService);
      requireCsrf(request, session, authService);
      const { artifactId } = z
        .object({ artifactId: uuidSchema })
        .parse(request.params);
      const idempotencyKey = uuidSchema.parse(
        request.headers['idempotency-key'],
      );
      return reply
        .code(202)
        .send(
          await service.createRestorePreview(
            session.ownerId,
            artifactId,
            idempotencyKey,
          ),
        );
    },
  );

  server.get('/api/backups/previews/:previewId', async (request) => {
    const session = await requireSession(request, authService);
    const { previewId } = z
      .object({ previewId: uuidSchema })
      .parse(request.params);
    return service.getPreview(session.ownerId, previewId);
  });

  server.post('/api/backups/restore', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        previewId: uuidSchema,
      })
      .parse(request.body);
    await authService.verifyCurrentPassword(session, input.currentPassword);
    const idempotencyKey = uuidSchema.parse(request.headers['idempotency-key']);
    return reply
      .code(202)
      .send(
        await service.enqueueRestore(
          session.ownerId,
          input.previewId,
          idempotencyKey,
        ),
      );
  });
}
