export interface OwnerRecord {
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  normalizedEmail: string;
  passwordHash: string;
}

export interface PublicOwner {
  displayName: string;
  email: string;
  id: string;
}

export interface SessionRecord {
  createdAt: Date;
  csrfTokenHash: string;
  expiresAt: Date;
  id: string;
  ipHash: string;
  lastSeenAt: Date;
  ownerId: string;
  tokenHash: string;
  userAgent: string;
}

export interface AuthenticatedSession extends SessionRecord {
  owner: PublicOwner;
}

export interface ClientContext {
  ipAddress: string;
  userAgent: string;
}

export interface SessionSecrets {
  csrfToken: string;
  expiresAt: Date;
  sessionToken: string;
}

export interface AuthSuccess {
  owner: PublicOwner;
  secrets: SessionSecrets;
}

export interface BootstrapState {
  authenticated: boolean;
  owner: PublicOwner | null;
  sessionExpiresAt: string | null;
  setupRequired: boolean;
}

export interface SessionSummary {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  userAgent: string;
}

export type SessionRevokeReason =
  'expired' | 'logout' | 'logout_all' | 'logout_others' | 'password_changed';

export interface RateLimitRecord {
  attempts: number;
  blockedUntil: Date | null;
  keyHash: string;
  updatedAt: Date;
  windowStartedAt: Date;
}

export interface NewOwnerInput {
  displayName: string;
  email: string;
  id: string;
  normalizedEmail: string;
  passwordHash: string;
}

export interface NewSessionInput extends SessionRecord {
  auditEventId: string;
  auditEventType: 'auth.login' | 'owner.setup';
  auditMetadata: Record<string, unknown>;
}

export interface AuthServiceContract {
  authenticate(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedSession | null>;
  bootstrap(sessionToken: string | undefined): Promise<BootstrapState>;
  changePassword(
    session: AuthenticatedSession,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  isValidCsrf(session: AuthenticatedSession, token: string): boolean;
  listSessions(session: AuthenticatedSession): Promise<SessionSummary[]>;
  login(
    email: string,
    password: string,
    client: ClientContext,
  ): Promise<AuthSuccess>;
  logout(session: AuthenticatedSession): Promise<void>;
  logoutAll(session: AuthenticatedSession): Promise<void>;
  logoutOthers(session: AuthenticatedSession): Promise<number>;
  setupOwner(
    displayName: string,
    email: string,
    password: string,
    client: ClientContext,
  ): Promise<AuthSuccess>;
  updateProfile(
    session: AuthenticatedSession,
    currentPassword: string,
    displayName: string,
    email: string,
  ): Promise<PublicOwner>;
  verifyCurrentPassword(
    session: AuthenticatedSession,
    currentPassword: string,
  ): Promise<void>;
}
