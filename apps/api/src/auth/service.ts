import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

import { AppError } from '../errors';
import type { AuthStore } from './store';
import type {
  AuthenticatedSession,
  AuthServiceContract,
  AuthSuccess,
  BootstrapState,
  ClientContext,
  NewSessionInput,
  PublicOwner,
  SessionSecrets,
  SessionSummary,
} from './types';

const PASSWORD_HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 65_536,
  outputLen: 32,
  parallelism: 1,
  timeCost: 3,
} as const;

export function hashOwnerPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

function toPublicOwner(owner: {
  displayName: string;
  email: string;
  id: string;
}): PublicOwner {
  return {
    displayName: owner.displayName,
    email: owner.email,
    id: owner.id,
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

function safeUserAgent(userAgent: string): string {
  const normalized = userAgent.trim().replaceAll(/\p{Cc}/gu, '');
  return normalized.slice(0, 512) || 'Unknown device';
}

export class AuthService implements AuthServiceContract {
  constructor(
    private readonly store: AuthStore,
    private readonly sessionSecret: string,
    private readonly sessionTtlHours: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private hashOpaqueValue(value: string): string {
    return createHmac('sha256', this.sessionSecret).update(value).digest('hex');
  }

  private equalsOpaqueHash(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private createSession({
    auditEventType,
    auditMetadata,
    client,
    ownerId,
  }: {
    auditEventType: NewSessionInput['auditEventType'];
    auditMetadata: Record<string, unknown>;
    client: ClientContext;
    ownerId: string;
  }): { record: NewSessionInput; secrets: SessionSecrets } {
    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.sessionTtlHours * 60 * 60 * 1_000,
    );
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');

    return {
      record: {
        auditEventId: randomUUID(),
        auditEventType,
        auditMetadata,
        createdAt,
        csrfTokenHash: this.hashOpaqueValue(csrfToken),
        expiresAt,
        id: randomUUID(),
        ipHash: this.hashOpaqueValue(client.ipAddress),
        lastSeenAt: createdAt,
        ownerId,
        tokenHash: this.hashOpaqueValue(sessionToken),
        userAgent: safeUserAgent(client.userAgent),
      },
      secrets: {
        csrfToken,
        expiresAt,
        sessionToken,
      },
    };
  }

  async bootstrap(sessionToken: string | undefined): Promise<BootstrapState> {
    const [owner, session] = await Promise.all([
      this.store.getOwner(),
      this.authenticate(sessionToken),
    ]);

    return {
      authenticated: Boolean(session),
      owner: session?.owner ?? null,
      sessionExpiresAt: session?.expiresAt.toISOString() ?? null,
      setupRequired: owner === null,
    };
  }

  async setupOwner(
    displayName: string,
    email: string,
    password: string,
    client: ClientContext,
  ): Promise<AuthSuccess> {
    if (await this.store.getOwner()) {
      throw new AppError({
        code: 'SETUP_ALREADY_COMPLETE',
        message: 'The owner account has already been created.',
        statusCode: 409,
      });
    }

    const ownerId = randomUUID();
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await hashOwnerPassword(password);
    const { record, secrets } = this.createSession({
      auditEventType: 'owner.setup',
      auditMetadata: { method: 'interactive_setup' },
      client,
      ownerId,
    });

    try {
      await this.store.createOwnerWithSession({
        owner: {
          displayName: displayName.trim(),
          email: email.trim(),
          id: ownerId,
          normalizedEmail,
          passwordHash,
        },
        session: record,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: 'SETUP_ALREADY_COMPLETE',
          message: 'The owner account has already been created.',
          statusCode: 409,
        });
      }
      throw error;
    }

    return {
      owner: {
        displayName: displayName.trim(),
        email: email.trim(),
        id: ownerId,
      },
      secrets,
    };
  }

  async login(
    email: string,
    password: string,
    client: ClientContext,
  ): Promise<AuthSuccess> {
    const now = this.now();
    const normalizedEmail = normalizeEmail(email);
    const rateLimitKey = this.hashOpaqueValue(
      `login:${normalizedEmail}:${client.ipAddress}`,
    );
    const rateLimit = await this.store.getRateLimit(rateLimitKey);

    if (rateLimit?.blockedUntil && rateLimit.blockedUntil > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((rateLimit.blockedUntil.getTime() - now.getTime()) / 1_000),
      );
      throw new AppError({
        code: 'LOGIN_RATE_LIMITED',
        message: 'Too many sign-in attempts. Wait a little and try again.',
        retryAfterSeconds,
        statusCode: 429,
      });
    }

    const owner = await this.store.getOwner();
    if (!owner) {
      throw new AppError({
        code: 'SETUP_REQUIRED',
        message: 'Create the owner account before signing in.',
        statusCode: 409,
      });
    }

    const [passwordMatches, emailMatches] = await Promise.all([
      verify(owner.passwordHash, password),
      Promise.resolve(
        this.equalsOpaqueHash(
          this.hashOpaqueValue(normalizedEmail),
          this.hashOpaqueValue(owner.normalizedEmail),
        ),
      ),
    ]);

    if (!passwordMatches || !emailMatches) {
      const updatedRateLimit = await this.store.recordLoginFailure(
        rateLimitKey,
        now,
      );
      await this.store.appendAuditEvent({
        eventId: randomUUID(),
        eventType: 'auth.login_failed',
        metadata: {
          attemptsInWindow: updatedRateLimit.attempts,
          reason: 'invalid_credentials',
        },
        ownerId: owner.id,
        sessionId: null,
      });
      throw new AppError({
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is not correct.',
        statusCode: 401,
      });
    }

    await this.store.clearRateLimit(rateLimitKey);
    const { record, secrets } = this.createSession({
      auditEventType: 'auth.login',
      auditMetadata: { method: 'password' },
      client,
      ownerId: owner.id,
    });
    await this.store.createSession(record);

    return { owner: toPublicOwner(owner), secrets };
  }

  async authenticate(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!sessionToken) {
      return null;
    }

    const now = this.now();
    const session = await this.store.findActiveSession(
      this.hashOpaqueValue(sessionToken),
      now,
    );
    if (!session) {
      return null;
    }

    await this.store.touchSession(session.id, now);
    return session;
  }

  isValidCsrf(session: AuthenticatedSession, token: string): boolean {
    return this.equalsOpaqueHash(
      this.hashOpaqueValue(token),
      session.csrfTokenHash,
    );
  }

  async listSessions(session: AuthenticatedSession): Promise<SessionSummary[]> {
    return this.store.listActiveSessions(
      session.ownerId,
      session.id,
      this.now(),
    );
  }

  async logout(session: AuthenticatedSession): Promise<void> {
    await this.store.revokeSession({
      eventId: randomUUID(),
      eventType: 'auth.logout',
      metadata: {},
      now: this.now(),
      ownerId: session.ownerId,
      reason: 'logout',
      sessionId: session.id,
    });
  }

  async logoutOthers(session: AuthenticatedSession): Promise<number> {
    return this.store.revokeOtherSessions({
      currentSessionId: session.id,
      eventId: randomUUID(),
      eventType: 'auth.logout_others',
      now: this.now(),
      ownerId: session.ownerId,
      reason: 'logout_others',
    });
  }

  async logoutAll(session: AuthenticatedSession): Promise<void> {
    await this.store.revokeAllSessions({
      currentSessionId: session.id,
      eventId: randomUUID(),
      now: this.now(),
      ownerId: session.ownerId,
    });
  }

  async updateProfile(
    session: AuthenticatedSession,
    currentPassword: string,
    displayName: string,
    email: string,
  ): Promise<PublicOwner> {
    const owner = await this.store.getOwner();
    if (!owner || owner.id !== session.ownerId) {
      throw new AppError({
        code: 'AUTH_REQUIRED',
        message: 'Sign in again to continue.',
        statusCode: 401,
      });
    }
    if (!(await verify(owner.passwordHash, currentPassword))) {
      throw new AppError({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not correct.',
        statusCode: 400,
      });
    }

    const nextDisplayName = displayName.trim();
    const nextEmail = email.trim();
    const nextNormalizedEmail = normalizeEmail(nextEmail);

    try {
      await this.store.updateProfile({
        currentSessionId: session.id,
        displayName: nextDisplayName,
        email: nextEmail,
        emailChanged: owner.normalizedEmail !== nextNormalizedEmail,
        eventId: randomUUID(),
        nameChanged: owner.displayName !== nextDisplayName,
        normalizedEmail: nextNormalizedEmail,
        now: this.now(),
        ownerId: session.ownerId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: 'EMAIL_CONFLICT',
          message: 'That email address is already in use.',
          statusCode: 409,
        });
      }
      throw error;
    }

    return {
      displayName: nextDisplayName,
      email: nextEmail,
      id: owner.id,
    };
  }

  async changePassword(
    session: AuthenticatedSession,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const owner = await this.store.getOwner();
    if (!owner || owner.id !== session.ownerId) {
      throw new AppError({
        code: 'AUTH_REQUIRED',
        message: 'Sign in again to continue.',
        statusCode: 401,
      });
    }

    if (!(await verify(owner.passwordHash, currentPassword))) {
      throw new AppError({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not correct.',
        statusCode: 400,
      });
    }
    if (await verify(owner.passwordHash, newPassword)) {
      throw new AppError({
        code: 'PASSWORD_REUSED',
        message: 'Choose a password you are not currently using.',
        statusCode: 400,
      });
    }

    const newPasswordHash = await hashOwnerPassword(newPassword);
    await this.store.changePassword({
      currentSessionId: session.id,
      eventId: randomUUID(),
      newPasswordHash,
      now: this.now(),
      ownerId: session.ownerId,
    });
  }

  async verifyCurrentPassword(
    session: AuthenticatedSession,
    currentPassword: string,
  ): Promise<void> {
    const owner = await this.store.getOwner();
    if (
      !owner ||
      owner.id !== session.ownerId ||
      !(await verify(owner.passwordHash, currentPassword))
    ) {
      throw new AppError({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not correct.',
        statusCode: 400,
      });
    }
  }
}
