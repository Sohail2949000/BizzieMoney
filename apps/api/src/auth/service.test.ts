import { hash, verify } from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './service';
import type { AuthStore } from './store';
import type { NewOwnerInput, NewSessionInput } from './types';

function createStore(): AuthStore {
  return {
    appendAuditEvent: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve(0)),
    clearRateLimit: vi.fn(() => Promise.resolve()),
    createOwnerWithSession: vi.fn(() => Promise.resolve()),
    createSession: vi.fn(() => Promise.resolve()),
    findActiveSession: vi.fn(() => Promise.resolve(null)),
    getOwner: vi.fn(() => Promise.resolve(null)),
    getRateLimit: vi.fn(() => Promise.resolve(null)),
    listActiveSessions: vi.fn(() => Promise.resolve([])),
    recordLoginFailure: vi.fn((keyHash: string, now: Date) =>
      Promise.resolve({
        attempts: 1,
        blockedUntil: null,
        keyHash,
        updatedAt: now,
        windowStartedAt: now,
      }),
    ),
    revokeAllSessions: vi.fn(() => Promise.resolve(0)),
    revokeOtherSessions: vi.fn(() => Promise.resolve(0)),
    revokeSession: vi.fn(() => Promise.resolve(0)),
    touchSession: vi.fn(() => Promise.resolve()),
    updateProfile: vi.fn(() => Promise.resolve()),
  };
}

describe('AuthService', () => {
  it('creates an Argon2id owner credential and hashed session secrets', async () => {
    const store = createStore();
    let created: { owner: NewOwnerInput; session: NewSessionInput } | undefined;
    store.createOwnerWithSession = vi.fn(
      (input: { owner: NewOwnerInput; session: NewSessionInput }) => {
        created = input;
        return Promise.resolve();
      },
    );
    const service = new AuthService(
      store,
      'a'.repeat(64),
      168,
      () => new Date('2026-07-27T08:00:00.000Z'),
    );

    const result = await service.setupOwner(
      ' Jamie ',
      'Jamie@Example.com',
      'a-long-owner-password',
      { ipAddress: '127.0.0.1', userAgent: 'Test browser' },
    );

    expect(created).toBeDefined();
    expect(created?.owner.normalizedEmail).toBe('jamie@example.com');
    expect(created?.owner.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verify(created?.owner.passwordHash ?? '', 'a-long-owner-password'),
    ).resolves.toBe(true);
    expect(created?.session.tokenHash).not.toBe(result.secrets.sessionToken);
    expect(created?.session.csrfTokenHash).not.toBe(result.secrets.csrfToken);
    expect(
      service.isValidCsrf(
        {
          ...created!.session,
          owner: result.owner,
        },
        result.secrets.csrfToken,
      ),
    ).toBe(true);
  });

  it('stops rate-limited login attempts before loading or hashing owner data', async () => {
    const store = createStore();
    store.getRateLimit = vi.fn(() =>
      Promise.resolve({
        attempts: 5,
        blockedUntil: new Date('2026-07-27T08:10:00.000Z'),
        keyHash: 'rate-key',
        updatedAt: new Date('2026-07-27T08:00:00.000Z'),
        windowStartedAt: new Date('2026-07-27T08:00:00.000Z'),
      }),
    );
    const service = new AuthService(
      store,
      'b'.repeat(64),
      168,
      () => new Date('2026-07-27T08:05:00.000Z'),
    );

    await expect(
      service.login('jamie@example.com', 'wrong-password', {
        ipAddress: '127.0.0.1',
        userAgent: 'Test browser',
      }),
    ).rejects.toMatchObject({
      code: 'LOGIN_RATE_LIMITED',
      statusCode: 429,
    });
  });

  it('confirms the current password before updating normalized owner details', async () => {
    const store = createStore();
    const passwordHash = await hash('current-owner-password');
    store.getOwner = vi.fn(() =>
      Promise.resolve({
        createdAt: new Date('2026-07-27T08:00:00.000Z'),
        displayName: 'Jamie',
        email: 'jamie@example.com',
        id: '00000000-0000-4000-8000-000000000001',
        normalizedEmail: 'jamie@example.com',
        passwordHash,
      }),
    );
    const service = new AuthService(
      store,
      'c'.repeat(64),
      168,
      () => new Date('2026-07-27T09:00:00.000Z'),
    );
    const session = {
      createdAt: new Date('2026-07-27T08:00:00.000Z'),
      csrfTokenHash: 'csrf-hash',
      expiresAt: new Date('2026-08-03T08:00:00.000Z'),
      id: '00000000-0000-4000-8000-000000000002',
      ipHash: 'ip-hash',
      lastSeenAt: new Date('2026-07-27T08:00:00.000Z'),
      owner: {
        displayName: 'Jamie',
        email: 'jamie@example.com',
        id: '00000000-0000-4000-8000-000000000001',
      },
      ownerId: '00000000-0000-4000-8000-000000000001',
      tokenHash: 'token-hash',
      userAgent: 'Test browser',
    };

    await expect(
      service.updateProfile(
        session,
        'current-owner-password',
        ' Jamie Doe ',
        'Jamie.Doe@Example.com ',
      ),
    ).resolves.toEqual({
      displayName: 'Jamie Doe',
      email: 'Jamie.Doe@Example.com',
      id: session.ownerId,
    });
    expect(store.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSessionId: session.id,
        displayName: 'Jamie Doe',
        email: 'Jamie.Doe@Example.com',
        emailChanged: true,
        nameChanged: true,
        normalizedEmail: 'jamie.doe@example.com',
        ownerId: session.ownerId,
      }),
    );
  });
});
