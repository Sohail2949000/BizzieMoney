import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import { apiInfo } from '@bizziemoney/shared';

import { registerAttachmentRoutes } from './attachments/routes.js';
import type { AttachmentServiceContract } from './attachments/types.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { AuthServiceContract } from './auth/types.js';
import { registerBackupRoutes } from './backups/routes.js';
import type { BackupServiceContract } from './backups/types.js';
import { registerDebtRoutes } from './debts/routes.js';
import type { DebtServiceContract } from './debts/types.js';
import { registerDataRoutes } from './data/routes.js';
import type { DataServiceContract } from './data/types.js';
import { AppError } from './errors.js';
import { registerExpenseRoutes } from './expenses/routes.js';
import type { ExpenseServiceContract } from './expenses/types.js';
import { registerPreferenceRoutes } from './preferences/routes.js';
import type { PreferenceServiceContract } from './preferences/types.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';
import type { SubscriptionServiceContract } from './subscriptions/types.js';

export interface BuildServerOptions {
  appOrigin: string;
  appOrigins?: readonly string[];
  attachmentService: AttachmentServiceContract;
  authService: AuthServiceContract;
  backupService: BackupServiceContract;
  contentSecurityPolicy?: boolean;
  cookieSecure: boolean | ((request: FastifyRequest) => boolean);
  dataService: DataServiceContract;
  debtService: DebtServiceContract;
  expenseService: ExpenseServiceContract;
  logger?: boolean;
  maxUploadSizeBytes: number;
  preferenceService: PreferenceServiceContract;
  readinessCheck: () => Promise<void>;
  subscriptionService: SubscriptionServiceContract;
}

export function buildServer(
  {
    appOrigin,
    appOrigins = [appOrigin],
    attachmentService,
    authService,
    backupService,
    contentSecurityPolicy = false,
    cookieSecure,
    dataService,
    debtService,
    expenseService,
    logger = true,
    maxUploadSizeBytes,
    preferenceService,
    readinessCheck,
    subscriptionService,
  }: BuildServerOptions,
  fastifyFactory: typeof Fastify = Fastify,
): FastifyInstance {
  const allowedOrigins = [...new Set([appOrigin, ...appOrigins])];
  const allowedOriginSet = new Set(allowedOrigins);
  const resolveCookieSecure =
    typeof cookieSecure === 'function' ? cookieSecure : () => cookieSecure;
  const server = fastifyFactory({
    logController: new LogController({
      disableRequestLogging: false,
      requestIdLogLabel: 'requestId',
    }),
    logger,
    requestIdHeader: 'x-request-id',
    trustProxy: false,
  });

  void server.register(cookie);
  void server.register(cors, {
    allowedHeaders: [
      'content-type',
      'idempotency-key',
      'x-bm-csrf',
      'x-request-id',
    ],
    credentials: true,
    methods: ['DELETE', 'GET', 'PATCH', 'POST', 'OPTIONS'],
    origin: allowedOrigins,
  });
  void server.register(helmet, {
    contentSecurityPolicy: contentSecurityPolicy
      ? {
          directives: {
            baseUri: ["'self'"],
            connectSrc: ["'self'"],
            defaultSrc: ["'self'"],
            fontSrc: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", 'blob:', 'data:'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  void server.register(multipart, {
    limits: {
      fileSize: maxUploadSizeBytes,
      files: 1,
      fields: 0,
      parts: 1,
    },
  });

  server.addHook('preHandler', (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return Promise.resolve();
    }
    const requestOrigin = request.headers.origin;
    if (!requestOrigin || !allowedOriginSet.has(requestOrigin)) {
      return Promise.reject(
        new AppError({
          code: 'ORIGIN_INVALID',
          message:
            'This request did not come from the BizzieMoney application.',
          statusCode: 403,
        }),
      );
    }
    return Promise.resolve();
  });

  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) {
      void reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  server.get('/', () => ({
    ...apiInfo,
    status: 'phase-11-ready',
  }));

  server.get('/health', () => ({
    status: 'ok',
    version: apiInfo.version,
  }));

  server.get('/ready', async (_request, reply) => {
    try {
      await readinessCheck();
      return {
        database: 'connected',
        status: 'ready',
        version: apiInfo.version,
      };
    } catch (error) {
      const databaseError =
        error && typeof error === 'object'
          ? {
              code:
                'code' in error && typeof error.code === 'string'
                  ? error.code
                  : undefined,
              name: error instanceof Error ? error.name : 'UnknownError',
            }
          : { name: 'UnknownError' };
      server.log.error({ databaseError }, 'Database readiness check failed');
      return reply.code(503).send({
        database: 'unavailable',
        status: 'not-ready',
        version: apiInfo.version,
      });
    }
  });

  registerAuthRoutes(server, {
    cookieSecure: resolveCookieSecure,
    service: authService,
  });
  registerBackupRoutes(server, {
    authService,
    service: backupService,
  });
  registerAttachmentRoutes(server, {
    authService,
    service: attachmentService,
  });
  registerDataRoutes(server, {
    authService,
    service: dataService,
  });
  registerDebtRoutes(server, {
    authService,
    service: debtService,
  });
  registerExpenseRoutes(server, {
    authService,
    service: expenseService,
  });
  registerPreferenceRoutes(server, {
    authService,
    service: preferenceService,
  });
  registerSubscriptionRoutes(server, {
    authService,
    service: subscriptionService,
  });

  server.setErrorHandler((error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'FST_REQ_FILE_TOO_LARGE' ||
        error.code === 'FST_FILES_LIMIT')
    ) {
      return reply.code(413).send({
        error: {
          code: 'ATTACHMENT_TOO_LARGE',
          message: 'The selected file exceeds the upload limit.',
          requestId: request.id,
        },
      });
    }
    if (error instanceof AppError) {
      if (error.retryAfterSeconds) {
        void reply.header('retry-after', error.retryAfterSeconds);
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error instanceof z.ZodError) {
      const fields = Object.fromEntries(
        error.issues.map((issue) => [
          String(issue.path[0] ?? 'request'),
          issue.message,
        ]),
      );
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          fields,
          message: 'Please check the highlighted information.',
          requestId: request.id,
        },
      });
    }

    request.log.error({ error }, 'Unhandled request error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'BizzieMoney could not complete that request.',
        requestId: request.id,
      },
    });
  });

  return server;
}
