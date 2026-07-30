import { createReadStream } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireCsrf, requireSession } from '../auth/routes';
import type { AuthServiceContract } from '../auth/types';
import type { DataServiceContract } from './types';

const purgeSchema = z.object({
  confirmation: z.string().max(100),
  currentPassword: z.string().min(1).max(128),
});

export function registerDataRoutes(
  server: FastifyInstance,
  {
    authService,
    service,
  }: {
    authService: AuthServiceContract;
    service: DataServiceContract;
  },
): void {
  server.get('/api/data/export', async (request, reply) => {
    const session = await requireSession(request, authService);
    const archive = await service.createPortableExport(session.ownerId);
    const cleanup = () => {
      void archive.cleanup();
    };
    reply.raw.once('close', cleanup);
    const stream = createReadStream(archive.filePath);
    stream.once('error', cleanup);
    void reply
      .header(
        'content-disposition',
        `attachment; filename="${archive.fileName}"`,
      )
      .type('application/gzip');
    return reply.send(stream);
  });

  server.post('/api/data/purge', async (request, reply) => {
    const session = await requireSession(request, authService);
    requireCsrf(request, session, authService);
    const idempotencyKey = z
      .string()
      .uuid()
      .parse(request.headers['idempotency-key']);
    const input = purgeSchema.parse(request.body);
    await authService.verifyCurrentPassword(session, input.currentPassword);
    const result = await service.purgeFinancialData(
      session.id,
      session.ownerId,
      idempotencyKey,
      input.confirmation,
    );
    if (result.replayed) {
      void reply.header('idempotency-replayed', 'true');
    }
    return reply.send(result);
  });
}
