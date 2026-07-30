import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  runMigrations,
  type BizzieMoneyDatabase,
} from '@bizziemoney/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/service';
import { PostgresAuthStore } from '../auth/store';
import { PreferenceService } from './service';
import { PostgresPreferenceStore } from './store';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_preferences_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-07-28T10:00:00.000Z');
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let ownerId = '';
let sessionId = '';
let service: PreferenceService;

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

integrationDescribe('PostgreSQL regional preferences', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-preferences-integration-admin',
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
      applicationName: 'bizziemoney-preferences-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 2,
    });
    const authService = new AuthService(
      new PostgresAuthStore(testDatabase),
      'preference-integration-session-secret-long-enough',
      24,
    );
    const auth = await authService.setupOwner(
      'Jamie',
      'jamie@example.com',
      'preference-integration-password',
      { ipAddress: '127.0.0.1', userAgent: 'Integration test' },
    );
    ownerId = auth.owner.id;
    sessionId = (await authService.authenticate(auth.secrets.sessionToken))!.id;
    service = new PreferenceService(
      new PostgresPreferenceStore(testDatabase),
      () => now,
    );
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
  });

  it('persists preferences, audits fields, and reschedules future backups', async () => {
    expect(await service.get(ownerId)).toMatchObject({
      dateFormat: 'MMM d, yyyy',
      defaultCurrency: 'USD',
      firstDayOfWeek: 0,
      numberFormat: '1,234.56',
      timeZone: 'Asia/Riyadh',
    });
    await testDatabase!
      .insertInto('backup_configs')
      .values({
        backup_time: '02:00',
        day_of_month: null,
        day_of_week: null,
        destination: 'local',
        enabled: true,
        encryption_password_ciphertext: null,
        frequency: 'daily',
        include_attachments: true,
        local_subfolder: 'automatic',
        next_run_at: new Date('2026-07-29T02:00:00.000Z'),
        owner_id: ownerId,
        retention_count: 7,
        s3_bucket: null,
        s3_credentials_ciphertext: null,
        s3_endpoint: null,
        s3_force_path_style: false,
        s3_prefix: null,
        s3_region: null,
      })
      .executeTakeFirstOrThrow();

    await expect(
      service.update(ownerId, sessionId, {
        dateFormat: 'dd/MM/yyyy',
        defaultCurrency: 'EUR',
        firstDayOfWeek: 1,
        numberFormat: '1.234,56',
        timeZone: 'America/New_York',
      }),
    ).resolves.toMatchObject({
      dateFormat: 'dd/MM/yyyy',
      defaultCurrency: 'EUR',
      firstDayOfWeek: 1,
      numberFormat: '1.234,56',
      timeZone: 'America/New_York',
    });

    const backup = await testDatabase!
      .selectFrom('backup_configs')
      .select('next_run_at')
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    expect(backup.next_run_at).toEqual(new Date('2026-07-29T06:00:00.000Z'));
    const audit = await testDatabase!
      .selectFrom('audit_events')
      .select(['actor_session_id', 'metadata'])
      .where('owner_id', '=', ownerId)
      .where('event_type', '=', 'settings.preferences_updated')
      .executeTakeFirstOrThrow();
    expect(audit.actor_session_id).toBe(sessionId);
    expect(audit.metadata).toEqual({
      changedFields: [
        'dateFormat',
        'defaultCurrency',
        'firstDayOfWeek',
        'numberFormat',
        'timeZone',
      ],
    });
  });
});
