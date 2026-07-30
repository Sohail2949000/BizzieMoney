import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

import type { AuthenticatedSession, AuthServiceContract } from './auth/types';
import type { AttachmentServiceContract } from './attachments/types';
import type { BackupServiceContract } from './backups/types';
import type { DebtServiceContract } from './debts/types';
import type { DataServiceContract } from './data/types';
import type { ExpenseServiceContract } from './expenses/types';
import type { PreferenceServiceContract } from './preferences/types';
import { requestUsesSecureCookies } from './request-security';
import { buildServer, type BuildServerOptions } from './server';
import type { SubscriptionServiceContract } from './subscriptions/types';

const owner = {
  displayName: 'Jamie',
  email: 'jamie@example.com',
  id: '00000000-0000-4000-8000-000000000001',
};
const authenticatedSession: AuthenticatedSession = {
  createdAt: new Date('2026-07-27T08:00:00.000Z'),
  csrfTokenHash: 'csrf-hash',
  expiresAt: new Date('2026-08-03T08:00:00.000Z'),
  id: '00000000-0000-4000-8000-000000000002',
  ipHash: 'ip-hash',
  lastSeenAt: new Date('2026-07-27T08:00:00.000Z'),
  owner,
  ownerId: owner.id,
  tokenHash: 'token-hash',
  userAgent: 'Test browser',
};

function createAuthService(): AuthServiceContract {
  return {
    authenticate: vi.fn(() => Promise.resolve(null)),
    bootstrap: vi.fn(() =>
      Promise.resolve({
        authenticated: false,
        owner: null,
        sessionExpiresAt: null,
        setupRequired: true,
      }),
    ),
    changePassword: vi.fn(() => Promise.resolve()),
    isValidCsrf: vi.fn(() => true),
    listSessions: vi.fn(() => Promise.resolve([])),
    login: vi.fn(() =>
      Promise.resolve({
        owner,
        secrets: {
          csrfToken: 'csrf-token',
          expiresAt: authenticatedSession.expiresAt,
          sessionToken: 'session-token',
        },
      }),
    ),
    logout: vi.fn(() => Promise.resolve()),
    logoutAll: vi.fn(() => Promise.resolve()),
    logoutOthers: vi.fn(() => Promise.resolve(0)),
    setupOwner: vi.fn(() =>
      Promise.resolve({
        owner,
        secrets: {
          csrfToken: 'csrf-token',
          expiresAt: authenticatedSession.expiresAt,
          sessionToken: 'session-token',
        },
      }),
    ),
    updateProfile: vi.fn(() => Promise.resolve(owner)),
    verifyCurrentPassword: vi.fn(() => Promise.resolve()),
  };
}

function createBackupService(): BackupServiceContract {
  return {
    createRestorePreview: vi.fn(),
    enqueueBackup: vi.fn(),
    enqueueRestore: vi.fn(),
    getConfig: vi.fn(() => Promise.resolve(null)),
    getPreview: vi.fn(),
    getStatus: vi.fn(() =>
      Promise.resolve({
        activeJob: null,
        config: null,
        configured: false,
        lastSuccessfulBackup: null,
        worker: { lastSeenAt: null, status: 'unknown' as const },
      }),
    ),
    listHistory: vi.fn(() => Promise.resolve({ artifacts: [], jobs: [] })),
    saveConfig: vi.fn(),
    testDestination: vi.fn(),
  };
}

function createExpenseService(): ExpenseServiceContract {
  return {
    createCategory: vi.fn(),
    createExpense: vi.fn(() =>
      Promise.resolve({
        expense: {
          amount: '18.50',
          attachmentCount: 0,
          category: {
            archived: false,
            color: '#16A36A',
            icon: 'utensils',
            id: '00000000-0000-4000-8000-000000000003',
            name: 'Food & Dining',
          },
          createdAt: '2026-07-27T08:00:00.000Z',
          currencyCode: 'USD',
          date: '2026-07-27',
          description: 'Lunch',
          id: '00000000-0000-4000-8000-000000000005',
          merchant: null,
          notes: null,
          paymentMethod: {
            archived: false,
            icon: 'circle-ellipsis',
            id: '00000000-0000-4000-8000-000000000004',
            name: 'Other',
          },
          tags: [],
          updatedAt: '2026-07-27T08:00:00.000Z',
        },
        replayed: false,
      }),
    ),
    createPaymentMethod: vi.fn(),
    deleteCategory: vi.fn(),
    deleteExpense: vi.fn(),
    exportExpenses: vi.fn(),
    getExpense: vi.fn(),
    getCategoryDeletionPreview: vi.fn(),
    getOptions: vi.fn(() =>
      Promise.resolve({ categories: [], paymentMethods: [] }),
    ),
    getSummary: vi.fn(),
    importExpenses: vi.fn(),
    listExpenses: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    previewImport: vi.fn(),
    updateCategory: vi.fn(),
    updateExpense: vi.fn(),
    updatePaymentMethod: vi.fn(),
  };
}

function createDataService(): DataServiceContract {
  return {
    createPortableExport: vi.fn(),
    purgeFinancialData: vi.fn(),
  };
}

function createAttachmentService(): AttachmentServiceContract {
  return {
    deleteAttachment: vi.fn(),
    getContent: vi.fn(),
    getThumbnail: vi.fn(),
    getStorageStatus: vi.fn(() =>
      Promise.resolve({
        allowedMimeTypes: ['application/pdf'],
        availableProviders: ['local'] as Array<'local' | 's3'>,
        configuration: {
          provider: 'local' as const,
          s3: null,
          source: 'environment' as const,
          updatedAt: null,
        },
        fileCount: 0,
        malwareScanner: 'not-configured' as const,
        maxUploadSizeBytes: 20 * 1_048_576,
        provider: 'local' as const,
        providerLabel: 'Local host folder',
        totalSizeBytes: 0,
      }),
    ),
    listDebtAttachments: vi.fn(() => Promise.resolve([])),
    listDebtPaymentAttachments: vi.fn(() => Promise.resolve([])),
    listExpenseAttachments: vi.fn(() => Promise.resolve([])),
    listSubscriptionAttachments: vi.fn(() => Promise.resolve([])),
    saveStorageConfig: vi.fn(() =>
      Promise.resolve({
        provider: 'local' as const,
        s3: null,
        source: 'settings' as const,
        updatedAt: '2026-07-29T00:00:00.000Z',
      }),
    ),
    testStorage: vi.fn(() =>
      Promise.resolve({ message: 'The local attachment folder is ready.' }),
    ),
    uploadDebtAttachment: vi.fn(),
    uploadDebtPaymentAttachment: vi.fn(),
    uploadExpenseAttachment: vi.fn(),
    uploadSubscriptionAttachment: vi.fn(),
  };
}

function createDebtService(): DebtServiceContract {
  return {
    changeStatus: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deletePayment: vi.fn(),
    get: vi.fn(),
    getSummary: vi.fn(() =>
      Promise.resolve({
        currencyGroups: [{ currencyCode: 'USD', iOwe: '0', owedToMe: '0' }],
        defaultCurrency: 'USD',
      }),
    ),
    list: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    listPayments: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    listUpcoming: vi.fn(() => Promise.resolve({ items: [], overdueCount: 0 })),
    recordPayment: vi.fn(),
    update: vi.fn(),
    updatePayment: vi.fn(),
  };
}

function createPreferenceService(): PreferenceServiceContract {
  return {
    get: vi.fn(() =>
      Promise.resolve({
        dateFormat: 'MMM d, yyyy' as const,
        defaultCurrency: 'USD',
        firstDayOfWeek: 0,
        numberFormat: '1,234.56' as const,
        timeZone: 'Asia/Riyadh',
        updatedAt: '2026-07-28T10:00:00.000Z',
      }),
    ),
    update: vi.fn(),
  };
}

function createSubscriptionService(): SubscriptionServiceContract {
  return {
    cancel: vi.fn(),
    convertPaymentToExpense: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    dismissReminder: vi.fn(),
    get: vi.fn(),
    list: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    listPayments: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    listReminders: vi.fn(() => Promise.resolve([])),
    listUpcoming: vi.fn(() =>
      Promise.resolve({ dueSoonCount: 0, items: [], overdueCount: 0 }),
    ),
    pause: vi.fn(),
    recordPayment: vi.fn(),
    resume: vi.fn(),
    update: vi.fn(),
  };
}

const servers: ReturnType<typeof buildServer>[] = [];

function createServer({
  appOrigins,
  attachmentService = createAttachmentService(),
  authService = createAuthService(),
  backupService = createBackupService(),
  contentSecurityPolicy = false,
  cookieSecure = false,
  dataService = createDataService(),
  debtService = createDebtService(),
  expenseService = createExpenseService(),
  preferenceService = createPreferenceService(),
  readinessCheck = () => Promise.resolve(),
  subscriptionService = createSubscriptionService(),
}: {
  appOrigins?: readonly string[];
  attachmentService?: AttachmentServiceContract;
  authService?: AuthServiceContract;
  backupService?: BackupServiceContract;
  contentSecurityPolicy?: boolean;
  cookieSecure?: BuildServerOptions['cookieSecure'];
  dataService?: DataServiceContract;
  debtService?: DebtServiceContract;
  expenseService?: ExpenseServiceContract;
  preferenceService?: PreferenceServiceContract;
  readinessCheck?: () => Promise<void>;
  subscriptionService?: SubscriptionServiceContract;
} = {}) {
  const server = buildServer({
    appOrigin: 'http://localhost:5173',
    ...(appOrigins ? { appOrigins } : {}),
    attachmentService,
    authService,
    backupService,
    contentSecurityPolicy,
    cookieSecure,
    dataService,
    debtService,
    expenseService,
    logger: false,
    maxUploadSizeBytes: 20 * 1_048_576,
    preferenceService,
    readinessCheck,
    subscriptionService,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('Phase 1 API boundary', () => {
  it('returns safe service metadata and health without configuration', async () => {
    const server = createServer();

    const [rootResponse, healthResponse] = await Promise.all([
      server.inject({ method: 'GET', url: '/' }),
      server.inject({ method: 'GET', url: '/health' }),
    ]);

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.json()).toEqual({
      name: 'bizziemoney-api',
      status: 'phase-11-ready',
      version: '1.0.0',
    });
    expect(healthResponse.json()).toEqual({
      status: 'ok',
      version: '1.0.0',
    });
    expect(rootResponse.body).not.toContain('DATABASE_URL');
  });

  it('enables a restrictive content security policy in production mode', async () => {
    const server = createServer({ contentSecurityPolicy: true });

    const response = await server.inject({ method: 'GET', url: '/health' });
    const policy = response.headers['content-security-policy'];

    expect(response.statusCode).toBe(200);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-eval');
  });

  it('reports database readiness without exposing the underlying error', async () => {
    const server = createServer({
      readinessCheck: () => Promise.reject(new Error('secret database detail')),
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      database: 'unavailable',
      status: 'not-ready',
      version: '1.0.0',
    });
    expect(response.body).not.toContain('secret database detail');
  });

  it('keeps unexpected API failures private and returns a request ID', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const expenseService = createExpenseService();
    expenseService.listExpenses = vi.fn(() =>
      Promise.reject(new Error('private database connection detail')),
    );
    const server = createServer({ authService, expenseService });

    const response = await server.inject({
      cookies: { bm_session: 'session-token' },
      method: 'GET',
      url: '/api/expenses',
    });

    expect(response.statusCode).toBe(500);
    const payload = response.json<{
      error: { code: string; message: string; requestId: string };
    }>();
    expect(payload).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'BizzieMoney could not complete that request.',
      },
    });
    expect(typeof payload.error.requestId).toBe('string');
    expect(response.body).not.toContain('private database connection detail');
    expect(response.body).not.toContain('stack');
  });

  it('creates the first owner only from the configured application origin', async () => {
    const authService = createAuthService();
    const server = createServer({ authService });
    const payload = {
      displayName: 'Jamie',
      email: 'jamie@example.com',
      password: 'a-long-owner-password',
    };

    const blockedResponse = await server.inject({
      method: 'POST',
      payload,
      url: '/api/auth/setup',
    });
    const response = await server.inject({
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      payload,
      url: '/api/auth/setup',
    });

    expect(blockedResponse.statusCode).toBe(403);
    expect(blockedResponse.json()).toMatchObject({
      error: { code: 'ORIGIN_INVALID' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bm_session=session-token'),
        expect.stringContaining('HttpOnly'),
        expect.stringContaining('SameSite=Strict'),
        expect.stringContaining('bm_csrf=csrf-token'),
      ]),
    );
  });

  it('accepts the exact tunnel origin and secures its authentication cookies', async () => {
    const tunnelOrigin = 'https://money.example.com';
    const appOrigins = ['http://localhost:5173', tunnelOrigin];
    const server = createServer({
      appOrigins,
      cookieSecure: (request) =>
        requestUsesSecureCookies(request, appOrigins, false),
    });
    const payload = {
      displayName: 'Jamie',
      email: 'jamie@example.com',
      password: 'a-long-owner-password',
    };

    const tunnelResponse = await server.inject({
      headers: { origin: tunnelOrigin },
      method: 'POST',
      payload,
      url: '/api/auth/setup',
    });
    const localhostResponse = await server.inject({
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      payload,
      url: '/api/auth/setup',
    });
    const unknownResponse = await server.inject({
      headers: { origin: 'https://unlisted.example' },
      method: 'POST',
      payload,
      url: '/api/auth/setup',
    });

    expect(tunnelResponse.statusCode).toBe(201);
    expect(tunnelResponse.headers['access-control-allow-origin']).toBe(
      tunnelOrigin,
    );
    expect(tunnelResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /bm_session=session-token;.*HttpOnly;.*Secure;.*SameSite=Strict/,
        ),
        expect.stringMatching(/bm_csrf=csrf-token;.*Secure;.*SameSite=Strict/),
      ]),
    );
    expect(localhostResponse.statusCode).toBe(201);
    expect(
      (localhostResponse.headers['set-cookie'] as string[]).every(
        (cookie) => !cookie.includes('Secure'),
      ),
    ).toBe(true);
    expect(unknownResponse.statusCode).toBe(403);
    expect(unknownResponse.json()).toMatchObject({
      error: { code: 'ORIGIN_INVALID' },
    });
  });

  it('requires both the session and matching CSRF proof for logout', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const server = createServer({ authService });

    const response = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'CSRF_INVALID' },
    });
  });

  it('requires password-confirmed owner profile updates behind CSRF protection', async () => {
    const authService = createAuthService();
    const updateProfile = vi.fn<AuthServiceContract['updateProfile']>(() =>
      Promise.resolve({
        ...owner,
        displayName: 'Jamie Doe',
        email: 'jamie.doe@example.com',
      }),
    );
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    authService.updateProfile = updateProfile;
    const server = createServer({ authService });
    const payload = {
      currentPassword: 'current-owner-password',
      displayName: 'Jamie Doe',
      email: 'jamie.doe@example.com',
    };

    const blocked = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'PATCH',
      payload,
      url: '/api/auth/profile',
    });
    const updated = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'PATCH',
      payload,
      url: '/api/auth/profile',
    });

    expect(blocked.statusCode).toBe(403);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      message: 'Account details updated.',
      owner: {
        displayName: 'Jamie Doe',
        email: 'jamie.doe@example.com',
      },
    });
    expect(updateProfile).toHaveBeenCalledWith(
      authenticatedSession,
      payload.currentPassword,
      payload.displayName,
      payload.email,
    );
  });

  it('protects and validates regional preference updates', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const saved = {
      dateFormat: 'dd/MM/yyyy' as const,
      defaultCurrency: 'EUR',
      firstDayOfWeek: 1,
      numberFormat: '1.234,56' as const,
      timeZone: 'Europe/Paris',
      updatedAt: '2026-07-28T10:00:00.000Z',
    };
    const update = vi.fn<PreferenceServiceContract['update']>(() =>
      Promise.resolve(saved),
    );
    const preferenceService = createPreferenceService();
    preferenceService.update = update;
    const server = createServer({ authService, preferenceService });

    const read = await server.inject({
      cookies: { bm_session: 'session-token' },
      method: 'GET',
      url: '/api/settings/preferences',
    });
    const blocked = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'PATCH',
      payload: { defaultCurrency: 'eur' },
      url: '/api/settings/preferences',
    });
    const invalid = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'PATCH',
      payload: { timeZone: 'Mars/Olympus' },
      url: '/api/settings/preferences',
    });
    const empty = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'PATCH',
      payload: {},
      url: '/api/settings/preferences',
    });
    const updated = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'PATCH',
      payload: {
        dateFormat: 'dd/MM/yyyy',
        defaultCurrency: 'eur',
        firstDayOfWeek: 1,
        numberFormat: '1.234,56',
        timeZone: 'Europe/Paris',
      },
      url: '/api/settings/preferences',
    });

    expect(read.statusCode).toBe(200);
    expect(blocked.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual(saved);
    expect(update).toHaveBeenCalledWith(owner.id, authenticatedSession.id, {
      dateFormat: 'dd/MM/yyyy',
      defaultCurrency: 'EUR',
      firstDayOfWeek: 1,
      numberFormat: '1.234,56',
      timeZone: 'Europe/Paris',
    });
  });

  it('requires owner authentication and CSRF before creating an expense', async () => {
    const authService = createAuthService();
    const expenseService = createExpenseService();
    const createExpense = vi.fn(
      expenseService.createExpense.bind(expenseService),
    );
    expenseService.createExpense = createExpense;
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const server = createServer({ authService, expenseService });
    const payload = {
      amount: '18.50',
      categoryId: '00000000-0000-4000-8000-000000000003',
      date: '2026-07-27',
      description: 'Lunch',
      merchant: null,
      notes: null,
      paymentMethodId: null,
      tags: [],
    };

    const blocked = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      payload,
      url: '/api/expenses',
    });
    const created = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        'idempotency-key': '00000000-0000-4000-8000-000000000006',
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload,
      url: '/api/expenses',
    });

    expect(blocked.statusCode).toBe(403);
    expect(created.statusCode).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(
      owner.id,
      authenticatedSession.id,
      '00000000-0000-4000-8000-000000000006',
      payload,
    );
  });

  it('previews category usage and requires CSRF for reassignment deletion', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const expenseService = createExpenseService();
    const categoryId = '00000000-0000-4000-8000-000000000003';
    const replacementCategoryId = '00000000-0000-4000-8000-000000000009';
    const preview = vi.fn(() =>
      Promise.resolve({
        category: {
          archived: false,
          color: '#16A36A',
          icon: 'utensils',
          id: categoryId,
          name: 'Food & Dining',
        },
        expenseCount: 2,
        replacements: [
          {
            archived: false,
            color: '#71717A',
            icon: 'circle-ellipsis',
            id: replacementCategoryId,
            name: 'Other',
          },
        ],
        subscriptionCount: 1,
      }),
    );
    const deleteCategory = vi.fn(() =>
      Promise.resolve({
        deletedCategoryId: categoryId,
        expenseCount: 2,
        replacement: {
          archived: false,
          color: '#71717A',
          icon: 'circle-ellipsis',
          id: replacementCategoryId,
          name: 'Other',
        },
        subscriptionCount: 1,
      }),
    );
    expenseService.getCategoryDeletionPreview = preview;
    expenseService.deleteCategory = deleteCategory;
    const server = createServer({ authService, expenseService });

    const usage = await server.inject({
      cookies: { bm_session: 'session-token' },
      method: 'GET',
      url: `/api/expense-categories/${categoryId}/deletion-preview`,
    });
    const blocked = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'DELETE',
      payload: { replacementCategoryId },
      url: `/api/expense-categories/${categoryId}`,
    });
    const deleted = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'DELETE',
      payload: { replacementCategoryId },
      url: `/api/expense-categories/${categoryId}`,
    });

    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({
      expenseCount: 2,
      subscriptionCount: 1,
    });
    expect(blocked.statusCode).toBe(403);
    expect(deleted.statusCode).toBe(200);
    expect(preview).toHaveBeenCalledWith(owner.id, categoryId);
    expect(deleteCategory).toHaveBeenCalledWith(
      owner.id,
      authenticatedSession.id,
      categoryId,
      replacementCategoryId,
    );
  });

  it('requires CSRF and an idempotency key for CSV preview and import', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const expenseService = createExpenseService();
    const previewImport = vi.fn(() =>
      Promise.resolve({
        errorCount: 0,
        rows: [],
        totalRows: 1,
        validCount: 1,
      }),
    );
    const importExpenses = vi.fn(() =>
      Promise.resolve({
        currencyCounts: { USD: 1 },
        importedCount: 1,
        replayed: false,
      }),
    );
    expenseService.previewImport = previewImport;
    expenseService.importExpenses = importExpenses;
    const server = createServer({ authService, expenseService });
    const payload = {
      csvText: 'Date,Description,Amount\n2026-07-28,Coffee,4.25',
    };

    const blocked = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      payload,
      url: '/api/expenses/import/preview',
    });
    const previewed = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload,
      url: '/api/expenses/import/preview',
    });
    const missingKey = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload,
      url: '/api/expenses/import',
    });
    const imported = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        'idempotency-key': '00000000-0000-4000-8000-000000000007',
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload,
      url: '/api/expenses/import',
    });

    expect(blocked.statusCode).toBe(403);
    expect(previewed.statusCode).toBe(200);
    expect(missingKey.statusCode).toBe(400);
    expect(imported.statusCode).toBe(201);
    expect(previewImport).toHaveBeenCalledWith(owner.id, payload.csvText);
    expect(importExpenses).toHaveBeenCalledWith(
      owner.id,
      authenticatedSession.id,
      '00000000-0000-4000-8000-000000000007',
      payload.csvText,
    );
  });

  it('allows the expense idempotency header through CORS preflight', async () => {
    const server = createServer();

    const response = await server.inject({
      headers: {
        'access-control-request-headers':
          'content-type,idempotency-key,x-bm-csrf',
        'access-control-request-method': 'POST',
        origin: 'http://localhost:5173',
      },
      method: 'OPTIONS',
      url: '/api/expenses',
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-headers']).toContain(
      'idempotency-key',
    );
  });

  it('protects attachment metadata and storage tests behind owner controls', async () => {
    const authService = createAuthService();
    const attachmentService = createAttachmentService();
    const saveStorageConfig = vi.fn<
      AttachmentServiceContract['saveStorageConfig']
    >(() =>
      Promise.resolve({
        provider: 'local',
        s3: null,
        source: 'settings',
        updatedAt: '2026-07-29T00:00:00.000Z',
      }),
    );
    const testStorage = vi.fn<AttachmentServiceContract['testStorage']>(() =>
      Promise.resolve({ message: 'The local attachment folder is ready.' }),
    );
    attachmentService.saveStorageConfig = saveStorageConfig;
    attachmentService.testStorage = testStorage;
    const server = createServer({ attachmentService, authService });

    const anonymous = await server.inject({
      method: 'GET',
      url: '/api/attachment-storage',
    });
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const missingCsrf = await server.inject({
      cookies: { bm_session: 'session-token' },
      headers: { origin: 'http://localhost:5173' },
      method: 'POST',
      url: '/api/attachment-storage/test',
    });
    const status = await server.inject({
      cookies: { bm_session: 'session-token' },
      method: 'GET',
      url: '/api/attachment-storage',
    });
    const saved = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'PATCH',
      payload: { provider: 'local', s3: null },
      url: '/api/attachment-storage',
    });
    const tested = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload: { provider: 'local', s3: null },
      url: '/api/attachment-storage/test',
    });
    const testedAwsStorage = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload: {
        provider: 's3',
        s3: {
          bucket: 'bizziemoney',
          forcePathStyle: false,
          prefix: 'bizziemoney',
          region: 'us-east-1',
        },
      },
      url: '/api/attachment-storage/test',
    });

    expect(anonymous.statusCode).toBe(401);
    expect(missingCsrf.statusCode).toBe(403);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      fileCount: 0,
      provider: 'local',
    });
    expect(status.body).not.toContain('/data/attachments');
    expect(saved.statusCode).toBe(200);
    expect(tested.statusCode).toBe(200);
    expect(testedAwsStorage.statusCode).toBe(200);
    expect(saveStorageConfig).toHaveBeenCalledWith(
      owner.id,
      authenticatedSession.id,
      { provider: 'local', s3: null },
    );
    expect(testStorage).toHaveBeenCalledWith(owner.id, {
      provider: 'local',
      s3: null,
    });
    expect(testStorage).toHaveBeenCalledWith(owner.id, {
      provider: 's3',
      s3: {
        bucket: 'bizziemoney',
        endpoint: null,
        forcePathStyle: false,
        prefix: 'bizziemoney',
        region: 'us-east-1',
      },
    });
  });

  it('requires the current password before enqueueing a restore', async () => {
    const authService = createAuthService();
    const verifyCurrentPassword = vi.fn<
      AuthServiceContract['verifyCurrentPassword']
    >(() => Promise.resolve());
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    authService.verifyCurrentPassword = verifyCurrentPassword;
    const backupService = createBackupService();
    const enqueueRestore = vi.fn<BackupServiceContract['enqueueRestore']>(() =>
      Promise.resolve({
        createdAt: '2026-07-28T10:00:00.000Z',
        errorMessage: null,
        finishedAt: null,
        id: '00000000-0000-4000-8000-000000000120',
        kind: 'restore',
        progressPercent: 0,
        progressStage: 'Queued',
        startedAt: null,
        status: 'queued',
        triggerType: 'manual',
      }),
    );
    backupService.enqueueRestore = enqueueRestore;
    const server = createServer({ authService, backupService });

    const response = await server.inject({
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        'idempotency-key': '00000000-0000-4000-8000-000000000121',
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST',
      payload: {
        currentPassword: 'owner-password',
        previewId: '00000000-0000-4000-8000-000000000122',
      },
      url: '/api/backups/restore',
    });

    expect(response.statusCode).toBe(202);
    expect(verifyCurrentPassword).toHaveBeenCalledWith(
      authenticatedSession,
      'owner-password',
    );
    expect(enqueueRestore).toHaveBeenCalledWith(
      owner.id,
      '00000000-0000-4000-8000-000000000122',
      '00000000-0000-4000-8000-000000000121',
    );
    expect(verifyCurrentPassword.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueRestore.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('streams a portable export only to an authenticated owner', async () => {
    const authService = createAuthService();
    const cleanup = vi.fn(() => Promise.resolve());
    const dataService = createDataService();
    const createPortableExport = vi.fn<
      DataServiceContract['createPortableExport']
    >(() =>
      Promise.resolve({
        cleanup,
        fileName: 'bizziemoney-full-export-2026-07-29.tar.gz',
        filePath: fileURLToPath(import.meta.url),
      }),
    );
    dataService.createPortableExport = createPortableExport;
    const server = createServer({ authService, dataService });

    const anonymous = await server.inject({
      method: 'GET',
      url: '/api/data/export',
    });
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const response = await server.inject({
      cookies: { bm_session: 'session-token' },
      method: 'GET',
      url: '/api/data/export',
    });

    expect(anonymous.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/gzip');
    expect(response.headers['content-disposition']).toContain(
      'bizziemoney-full-export-2026-07-29.tar.gz',
    );
    expect(createPortableExport).toHaveBeenCalledWith(owner.id);
  });

  it('verifies password, CSRF, and idempotency before purging financial data', async () => {
    const authService = createAuthService();
    authService.authenticate = vi.fn(() =>
      Promise.resolve(authenticatedSession),
    );
    const verifyCurrentPassword = vi.fn<
      AuthServiceContract['verifyCurrentPassword']
    >(() => Promise.resolve());
    authService.verifyCurrentPassword = verifyCurrentPassword;
    const dataService = createDataService();
    const purgeFinancialData = vi.fn<DataServiceContract['purgeFinancialData']>(
      () =>
        Promise.resolve({
          attachmentFilesQueued: 2,
          attachments: 1,
          completedAt: '2026-07-29T00:00:00.000Z',
          debtPayments: 1,
          debts: 1,
          expenses: 1,
          replayed: false,
          subscriptionPayments: 1,
          subscriptions: 1,
          tags: 1,
        }),
    );
    dataService.purgeFinancialData = purgeFinancialData;
    const server = createServer({ authService, dataService });
    const request = {
      cookies: { bm_csrf: 'csrf-token', bm_session: 'session-token' },
      headers: {
        'idempotency-key': '00000000-0000-4000-8000-000000000140',
        origin: 'http://localhost:5173',
        'x-bm-csrf': 'csrf-token',
      },
      method: 'POST' as const,
      payload: {
        confirmation: 'DELETE ALL DATA',
        currentPassword: 'owner-password',
      },
      url: '/api/data/purge',
    };

    const response = await server.inject(request);

    expect(response.statusCode).toBe(200);
    expect(verifyCurrentPassword).toHaveBeenCalledWith(
      authenticatedSession,
      'owner-password',
    );
    expect(purgeFinancialData).toHaveBeenCalledWith(
      authenticatedSession.id,
      owner.id,
      '00000000-0000-4000-8000-000000000140',
      'DELETE ALL DATA',
    );
    expect(verifyCurrentPassword.mock.invocationCallOrder[0]).toBeLessThan(
      purgeFinancialData.mock.invocationCallOrder[0] ?? Infinity,
    );

    const missingOrigin = await server.inject({
      ...request,
      headers: {
        'idempotency-key': '00000000-0000-4000-8000-000000000141',
        'x-bm-csrf': 'csrf-token',
      },
    });
    expect(missingOrigin.statusCode).toBe(403);
  });
});
