import {
  sql,
  type BizzieMoneyDatabase,
  type DatabaseSchema,
  type Transaction,
} from '@bizziemoney/database';

import type {
  AuthenticatedSession,
  NewOwnerInput,
  NewSessionInput,
  OwnerRecord,
  RateLimitRecord,
  SessionRecord,
  SessionRevokeReason,
  SessionSummary,
} from './types';

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1_000;

function mapOwner(row: {
  created_at: Date;
  display_name: string;
  email: string;
  id: string;
  normalized_email: string;
  password_hash: string;
}): OwnerRecord {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    normalizedEmail: row.normalized_email,
    passwordHash: row.password_hash,
  };
}

function mapSession(row: {
  created_at: Date;
  csrf_token_hash: string;
  expires_at: Date;
  id: string;
  ip_hash: string;
  last_seen_at: Date;
  owner_id: string;
  token_hash: string;
  user_agent: string;
}): SessionRecord {
  return {
    createdAt: row.created_at,
    csrfTokenHash: row.csrf_token_hash.trim(),
    expiresAt: row.expires_at,
    id: row.id,
    ipHash: row.ip_hash.trim(),
    lastSeenAt: row.last_seen_at,
    ownerId: row.owner_id,
    tokenHash: row.token_hash.trim(),
    userAgent: row.user_agent,
  };
}

export class PostgresAuthStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getOwner(): Promise<OwnerRecord | null> {
    const row = await this.database
      .selectFrom('app_users')
      .select([
        'created_at',
        'display_name',
        'email',
        'id',
        'normalized_email',
        'password_hash',
      ])
      .where('owner_slot', '=', 1)
      .executeTakeFirst();

    return row ? mapOwner(row) : null;
  }

  async createOwnerWithSession({
    owner,
    session,
  }: {
    owner: NewOwnerInput;
    session: NewSessionInput;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('app_users')
        .values({
          display_name: owner.displayName,
          email: owner.email,
          id: owner.id,
          normalized_email: owner.normalizedEmail,
          password_changed_at: session.createdAt,
          password_hash: owner.passwordHash,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('app_settings')
        .values({ owner_id: owner.id })
        .executeTakeFirstOrThrow();
      await sql`select seed_owner_expense_defaults(${owner.id}::uuid)`.execute(
        transaction,
      );
      await this.insertSessionAndAudit(transaction, session);
    });
  }

  async createSession(session: NewSessionInput): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await this.insertSessionAndAudit(transaction, session);
    });
  }

  private async insertSessionAndAudit(
    transaction: Transaction<DatabaseSchema>,
    session: NewSessionInput,
  ): Promise<void> {
    await transaction
      .insertInto('sessions')
      .values({
        created_at: session.createdAt,
        csrf_token_hash: session.csrfTokenHash,
        expires_at: session.expiresAt,
        id: session.id,
        ip_hash: session.ipHash,
        last_seen_at: session.lastSeenAt,
        owner_id: session.ownerId,
        revoked_at: null,
        revoke_reason: null,
        token_hash: session.tokenHash,
        user_agent: session.userAgent,
      })
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('audit_events')
      .values({
        actor_session_id: session.id,
        event_type: session.auditEventType,
        id: session.auditEventId,
        metadata: session.auditMetadata,
        owner_id: session.ownerId,
      })
      .executeTakeFirstOrThrow();
  }

  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedSession | null> {
    const row = await this.database
      .selectFrom('sessions')
      .innerJoin('app_users', 'app_users.id', 'sessions.owner_id')
      .select([
        'sessions.created_at',
        'sessions.csrf_token_hash',
        'sessions.expires_at',
        'sessions.id',
        'sessions.ip_hash',
        'sessions.last_seen_at',
        'sessions.owner_id',
        'sessions.token_hash',
        'sessions.user_agent',
        'app_users.display_name',
        'app_users.email',
      ])
      .where('sessions.token_hash', '=', tokenHash)
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.expires_at', '>', now)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return {
      ...mapSession(row),
      owner: {
        displayName: row.display_name,
        email: row.email,
        id: row.owner_id,
      },
    };
  }

  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.database
      .updateTable('sessions')
      .set({ last_seen_at: now })
      .where('id', '=', sessionId)
      .where('last_seen_at', '<', new Date(now.getTime() - 5 * 60 * 1_000))
      .where('revoked_at', 'is', null)
      .execute();
  }

  async listActiveSessions(
    ownerId: string,
    currentSessionId: string,
    now: Date,
  ): Promise<SessionSummary[]> {
    const rows = await this.database
      .selectFrom('sessions')
      .select(['created_at', 'expires_at', 'id', 'last_seen_at', 'user_agent'])
      .where('owner_id', '=', ownerId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .orderBy('last_seen_at', 'desc')
      .limit(100)
      .execute();

    return rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      current: row.id === currentSessionId,
      expiresAt: row.expires_at.toISOString(),
      id: row.id,
      lastSeenAt: row.last_seen_at.toISOString(),
      userAgent: row.user_agent,
    }));
  }

  async revokeSession({
    eventId,
    eventType,
    metadata,
    now,
    ownerId,
    reason,
    sessionId,
  }: {
    eventId: string;
    eventType: string;
    metadata: Record<string, unknown>;
    now: Date;
    ownerId: string;
    reason: SessionRevokeReason;
    sessionId: string;
  }): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable('sessions')
        .set({ revoke_reason: reason, revoked_at: now })
        .where('id', '=', sessionId)
        .where('owner_id', '=', ownerId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: sessionId,
          event_type: eventType,
          id: eventId,
          metadata,
          owner_id: ownerId,
        })
        .executeTakeFirstOrThrow();
      return Number(result.numUpdatedRows);
    });
  }

  async revokeOtherSessions({
    currentSessionId,
    eventId,
    eventType,
    now,
    ownerId,
    reason,
  }: {
    currentSessionId: string;
    eventId: string;
    eventType: string;
    now: Date;
    ownerId: string;
    reason: SessionRevokeReason;
  }): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable('sessions')
        .set({ revoke_reason: reason, revoked_at: now })
        .where('owner_id', '=', ownerId)
        .where('id', '!=', currentSessionId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      const count = Number(result.numUpdatedRows);
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: currentSessionId,
          event_type: eventType,
          id: eventId,
          metadata: { revokedSessionCount: count },
          owner_id: ownerId,
        })
        .executeTakeFirstOrThrow();
      return count;
    });
  }

  async revokeAllSessions({
    currentSessionId,
    eventId,
    now,
    ownerId,
  }: {
    currentSessionId: string;
    eventId: string;
    now: Date;
    ownerId: string;
  }): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable('sessions')
        .set({ revoke_reason: 'logout_all', revoked_at: now })
        .where('owner_id', '=', ownerId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      const count = Number(result.numUpdatedRows);
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: currentSessionId,
          event_type: 'auth.logout_all',
          id: eventId,
          metadata: { revokedSessionCount: count },
          owner_id: ownerId,
        })
        .executeTakeFirstOrThrow();
      return count;
    });
  }

  async updateProfile({
    currentSessionId,
    displayName,
    email,
    emailChanged,
    eventId,
    nameChanged,
    normalizedEmail,
    now,
    ownerId,
  }: {
    currentSessionId: string;
    displayName: string;
    email: string;
    emailChanged: boolean;
    eventId: string;
    nameChanged: boolean;
    normalizedEmail: string;
    now: Date;
    ownerId: string;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('app_users')
        .set({
          display_name: displayName,
          email,
          normalized_email: normalizedEmail,
          updated_at: now,
        })
        .where('id', '=', ownerId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: currentSessionId,
          event_type: 'owner.profile_update',
          id: eventId,
          metadata: { emailChanged, nameChanged },
          owner_id: ownerId,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async changePassword({
    currentSessionId,
    eventId,
    newPasswordHash,
    now,
    ownerId,
  }: {
    currentSessionId: string;
    eventId: string;
    newPasswordHash: string;
    now: Date;
    ownerId: string;
  }): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('app_users')
        .set({
          password_changed_at: now,
          password_hash: newPasswordHash,
          updated_at: now,
        })
        .where('id', '=', ownerId)
        .executeTakeFirstOrThrow();
      const result = await transaction
        .updateTable('sessions')
        .set({ revoke_reason: 'password_changed', revoked_at: now })
        .where('owner_id', '=', ownerId)
        .where('id', '!=', currentSessionId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      const count = Number(result.numUpdatedRows);
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: currentSessionId,
          event_type: 'auth.password_change',
          id: eventId,
          metadata: { revokedSessionCount: count },
          owner_id: ownerId,
        })
        .executeTakeFirstOrThrow();
      return count;
    });
  }

  async appendAuditEvent({
    eventId,
    eventType,
    metadata,
    ownerId,
    sessionId,
  }: {
    eventId: string;
    eventType: string;
    metadata: Record<string, unknown>;
    ownerId: string | null;
    sessionId: string | null;
  }): Promise<void> {
    await this.database
      .insertInto('audit_events')
      .values({
        actor_session_id: sessionId,
        event_type: eventType,
        id: eventId,
        metadata,
        owner_id: ownerId,
      })
      .executeTakeFirstOrThrow();
  }

  async getRateLimit(keyHash: string): Promise<RateLimitRecord | null> {
    const row = await this.database
      .selectFrom('auth_rate_limits')
      .selectAll()
      .where('key_hash', '=', keyHash)
      .executeTakeFirst();

    return row
      ? {
          attempts: row.attempts,
          blockedUntil: row.blocked_until,
          keyHash: row.key_hash.trim(),
          updatedAt: row.updated_at,
          windowStartedAt: row.window_started_at,
        }
      : null;
  }

  async recordLoginFailure(
    keyHash: string,
    now: Date,
  ): Promise<RateLimitRecord> {
    return this.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('auth_rate_limits')
        .values({
          attempts: 0,
          blocked_until: null,
          key_hash: keyHash,
          updated_at: now,
          window_started_at: now,
        })
        .onConflict((conflict) => conflict.column('key_hash').doNothing())
        .execute();

      const current = await transaction
        .selectFrom('auth_rate_limits')
        .selectAll()
        .where('key_hash', '=', keyHash)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const windowExpired =
        now.getTime() - current.window_started_at.getTime() >= LOGIN_WINDOW_MS;
      const attempts = windowExpired ? 1 : current.attempts + 1;
      const windowStartedAt = windowExpired ? now : current.window_started_at;
      const blockedUntil =
        attempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(now.getTime() + LOGIN_BLOCK_MS)
          : current.blocked_until && current.blocked_until > now
            ? current.blocked_until
            : null;

      await transaction
        .updateTable('auth_rate_limits')
        .set({
          attempts,
          blocked_until: blockedUntil,
          updated_at: now,
          window_started_at: windowStartedAt,
        })
        .where('key_hash', '=', keyHash)
        .executeTakeFirstOrThrow();

      return {
        attempts,
        blockedUntil,
        keyHash,
        updatedAt: now,
        windowStartedAt,
      };
    });
  }

  async clearRateLimit(keyHash: string): Promise<void> {
    await this.database
      .deleteFrom('auth_rate_limits')
      .where('key_hash', '=', keyHash)
      .execute();
  }
}

export type AuthStore = Pick<
  PostgresAuthStore,
  | 'appendAuditEvent'
  | 'changePassword'
  | 'clearRateLimit'
  | 'createOwnerWithSession'
  | 'createSession'
  | 'findActiveSession'
  | 'getOwner'
  | 'getRateLimit'
  | 'listActiveSessions'
  | 'recordLoginFailure'
  | 'revokeAllSessions'
  | 'revokeOtherSessions'
  | 'revokeSession'
  | 'touchSession'
  | 'updateProfile'
>;
