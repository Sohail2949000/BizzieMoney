import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError } from '../errors.js';
import type {
  AuthenticatedSession,
  AuthServiceContract,
  AuthSuccess,
  ClientContext,
} from './types.js';

export const SESSION_COOKIE_NAME = 'bm_session';
export const CSRF_COOKIE_NAME = 'bm_csrf';
export const CSRF_HEADER_NAME = 'x-bm-csrf';

const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use no more than 128 characters.');

const setupSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

const updateProfileSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
});

function clientContext(request: FastifyRequest): ClientContext {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? 'Unknown device',
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function setAuthCookies(
  reply: FastifyReply,
  auth: AuthSuccess,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, auth.secrets.sessionToken, {
    expires: auth.secrets.expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure,
  });
  reply.setCookie(CSRF_COOKIE_NAME, auth.secrets.csrfToken, {
    expires: auth.secrets.expiresAt,
    httpOnly: false,
    path: '/',
    sameSite: 'strict',
    secure,
  });
}

function clearAuthCookies(reply: FastifyReply, secure: boolean): void {
  const options = {
    path: '/',
    sameSite: 'strict' as const,
    secure,
  };
  reply.clearCookie(SESSION_COOKIE_NAME, {
    ...options,
    httpOnly: true,
  });
  reply.clearCookie(CSRF_COOKIE_NAME, {
    ...options,
    httpOnly: false,
  });
}

export async function requireSession(
  request: FastifyRequest,
  service: AuthServiceContract,
): Promise<AuthenticatedSession> {
  const session = await service.authenticate(
    request.cookies[SESSION_COOKIE_NAME],
  );
  if (!session) {
    throw new AppError({
      code: 'AUTH_REQUIRED',
      message: 'Sign in again to continue.',
      statusCode: 401,
    });
  }
  return session;
}

export function requireCsrf(
  request: FastifyRequest,
  session: AuthenticatedSession,
  service: AuthServiceContract,
): void {
  const headerToken = request.headers[CSRF_HEADER_NAME];
  const cookieToken = request.cookies[CSRF_COOKIE_NAME];
  if (
    typeof headerToken !== 'string' ||
    typeof cookieToken !== 'string' ||
    !safeEqual(headerToken, cookieToken) ||
    !service.isValidCsrf(session, headerToken)
  ) {
    throw new AppError({
      code: 'CSRF_INVALID',
      message: 'This request could not be verified. Refresh and try again.',
      statusCode: 403,
    });
  }
}

export function registerAuthRoutes(
  server: FastifyInstance,
  {
    cookieSecure,
    service,
  }: {
    cookieSecure: (request: FastifyRequest) => boolean;
    service: AuthServiceContract;
  },
): void {
  server.get('/api/auth/bootstrap', async (request, reply) => {
    const sessionToken = request.cookies[SESSION_COOKIE_NAME];
    const state = await service.bootstrap(sessionToken);
    if (sessionToken && !state.authenticated) {
      clearAuthCookies(reply, cookieSecure(request));
    }
    return state;
  });

  server.post('/api/auth/setup', async (request, reply) => {
    const input = setupSchema.parse(request.body);
    const auth = await service.setupOwner(
      input.displayName,
      input.email,
      input.password,
      clientContext(request),
    );
    setAuthCookies(reply, auth, cookieSecure(request));
    return reply.code(201).send({
      owner: auth.owner,
      sessionExpiresAt: auth.secrets.expiresAt.toISOString(),
    });
  });

  server.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const auth = await service.login(
      input.email,
      input.password,
      clientContext(request),
    );
    setAuthCookies(reply, auth, cookieSecure(request));
    return {
      owner: auth.owner,
      sessionExpiresAt: auth.secrets.expiresAt.toISOString(),
    };
  });

  server.get('/api/auth/sessions', async (request) => {
    const session = await requireSession(request, service);
    return { sessions: await service.listSessions(session) };
  });

  server.patch('/api/auth/profile', async (request) => {
    const session = await requireSession(request, service);
    requireCsrf(request, session, service);
    const input = updateProfileSchema.parse(request.body);
    const owner = await service.updateProfile(
      session,
      input.currentPassword,
      input.displayName,
      input.email,
    );
    return {
      message: 'Account details updated.',
      owner,
    };
  });

  server.post('/api/auth/logout', async (request, reply) => {
    const session = await requireSession(request, service);
    requireCsrf(request, session, service);
    await service.logout(session);
    clearAuthCookies(reply, cookieSecure(request));
    return reply.code(204).send();
  });

  server.post('/api/auth/logout-others', async (request) => {
    const session = await requireSession(request, service);
    requireCsrf(request, session, service);
    return { revokedSessionCount: await service.logoutOthers(session) };
  });

  server.post('/api/auth/logout-all', async (request, reply) => {
    const session = await requireSession(request, service);
    requireCsrf(request, session, service);
    await service.logoutAll(session);
    clearAuthCookies(reply, cookieSecure(request));
    return reply.code(204).send();
  });

  server.post('/api/auth/change-password', async (request) => {
    const session = await requireSession(request, service);
    requireCsrf(request, session, service);
    const input = changePasswordSchema.parse(request.body);
    await service.changePassword(
      session,
      input.currentPassword,
      input.newPassword,
    );
    return {
      message: 'Password changed. Other sessions have been signed out.',
    };
  });
}
