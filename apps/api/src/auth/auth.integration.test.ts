import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  runMigrations,
  type BizzieMoneyDatabase,
} from '@bizziemoney/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from './service';
import { PostgresAuthStore } from './store';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_auth_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let service: AuthService;

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

integrationDescribe('PostgreSQL owner authentication', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-auth-integration-admin',
      connectionString: baseConnectionString!,
      maxConnections: 1,
    });
    await adminDatabase.schema.createSchema(schemaName).execute();

    const isolatedConnectionString = schemaConnectionString(
      baseConnectionString!,
    );
    await runMigrations({
      connectionString: isolatedConnectionString,
      migrationsDirectory: fileURLToPath(
        new URL('../../../../packages/database/migrations', import.meta.url),
      ),
    });
    testDatabase = createDatabase({
      applicationName: 'bizziemoney-auth-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 2,
    });
    service = new AuthService(
      new PostgresAuthStore(testDatabase),
      'integration-session-secret-that-is-long-enough',
      24,
    );
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
  });

  it('persists setup, profile updates, login, session revocation, and password changes', async () => {
    const client = {
      ipAddress: '127.0.0.1',
      userAgent: 'Integration test browser',
    };
    const setup = await service.setupOwner(
      'Jamie',
      'jamie@example.com',
      'first-secure-password',
      client,
    );

    const setupSession = await service.authenticate(setup.secrets.sessionToken);
    expect(setupSession?.owner.email).toBe('jamie@example.com');

    await expect(
      service.login('jamie@example.com', 'not-the-password', client),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const login = await service.login(
      'JAMIE@example.com',
      'first-secure-password',
      client,
    );
    const loginSession = await service.authenticate(login.secrets.sessionToken);
    expect(loginSession).not.toBeNull();
    await expect(service.listSessions(loginSession!)).resolves.toHaveLength(2);

    await expect(
      service.updateProfile(
        loginSession!,
        'first-secure-password',
        'Jamie Doe',
        'jamie.doe@example.com',
      ),
    ).resolves.toMatchObject({
      displayName: 'Jamie Doe',
      email: 'jamie.doe@example.com',
    });
    await expect(
      service.authenticate(login.secrets.sessionToken),
    ).resolves.toMatchObject({
      owner: {
        displayName: 'Jamie Doe',
        email: 'jamie.doe@example.com',
      },
    });
    await expect(
      service.login('jamie@example.com', 'first-secure-password', client),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    await service.changePassword(
      loginSession!,
      'first-secure-password',
      'second-secure-password',
    );
    await expect(
      service.authenticate(setup.secrets.sessionToken),
    ).resolves.toBeNull();
    await expect(
      service.login('jamie.doe@example.com', 'first-secure-password', client),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      service.login('jamie.doe@example.com', 'second-secure-password', client),
    ).resolves.toMatchObject({ owner: { email: 'jamie.doe@example.com' } });
  }, 30_000);
});
