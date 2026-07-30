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
import { PostgresAttachmentStore } from './store';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_attachment_storage_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let ownerId = '';
let sessionId = '';
let store: PostgresAttachmentStore;

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

integrationDescribe('PostgreSQL attachment storage configuration', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-attachment-storage-integration-admin',
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
      applicationName: 'bizziemoney-attachment-storage-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 2,
    });
    const auth = await new AuthService(
      new PostgresAuthStore(testDatabase),
      'attachment-storage-integration-secret',
      24,
    ).setupOwner(
      'Storage Owner',
      'storage@example.com',
      'attachment-storage-password',
      { ipAddress: '127.0.0.1', userAgent: 'Integration test' },
    );
    ownerId = auth.owner.id;
    const session = await new AuthService(
      new PostgresAuthStore(testDatabase),
      'attachment-storage-integration-secret',
      24,
    ).authenticate(auth.secrets.sessionToken);
    sessionId = session!.id;
    store = new PostgresAttachmentStore(testDatabase);
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
  });

  it('retains historical S3 profiles and audits field names without secrets', async () => {
    const firstRoot = 'receipts-a/bizziemoney';
    await store.saveStorageConfig({
      activeProvider: 's3',
      changedFields: ['provider', 'bucket', 'credentials'],
      ownerId,
      s3Bucket: 'receipts-a',
      s3CredentialsCiphertext: 'v1.encrypted-first',
      s3Endpoint: 'https://first.r2.cloudflarestorage.com',
      s3ForcePathStyle: false,
      s3Prefix: 'bizziemoney',
      s3Region: 'auto',
      s3StorageRoot: firstRoot,
      sessionId,
    });
    await store.saveStorageConfig({
      activeProvider: 's3',
      changedFields: ['bucket', 'endpoint', 'credentials'],
      ownerId,
      s3Bucket: 'receipts-b',
      s3CredentialsCiphertext: 'v1.encrypted-second',
      s3Endpoint: 'https://second.r2.cloudflarestorage.com',
      s3ForcePathStyle: false,
      s3Prefix: 'archive',
      s3Region: 'auto',
      s3StorageRoot: 'receipts-b/archive',
      sessionId,
    });

    const current = await store.getStorageConfig(ownerId);
    const historical = await store.getStorageConfigForLocation(
      ownerId,
      's3',
      firstRoot,
    );
    const profiles = await testDatabase!
      .selectFrom('attachment_storage_s3_profiles')
      .select('storage_root')
      .where('owner_id', '=', ownerId)
      .orderBy('storage_root')
      .execute();
    const audits = await testDatabase!
      .selectFrom('audit_events')
      .select(['event_type', 'metadata'])
      .where('owner_id', '=', ownerId)
      .where('event_type', '=', 'attachment.storage_settings_changed')
      .orderBy('created_at')
      .execute();
    const meta = await testDatabase!
      .selectFrom('app_meta')
      .select(['application_version', 'schema_version'])
      .executeTakeFirstOrThrow();

    expect(current).toMatchObject({
      activeProvider: 's3',
      s3Bucket: 'receipts-b',
      s3Prefix: 'archive',
    });
    expect(historical).toMatchObject({
      s3Bucket: 'receipts-a',
      s3CredentialsCiphertext: 'v1.encrypted-first',
    });
    expect(profiles.map(({ storage_root }) => storage_root)).toEqual([
      firstRoot,
      'receipts-b/archive',
    ]);
    expect(audits).toHaveLength(2);
    expect(audits[1]?.metadata).toEqual({
      changedFields: ['bucket', 'endpoint', 'credentials'],
    });
    expect(JSON.stringify(audits)).not.toContain('encrypted-second');
    expect(meta).toEqual({
      application_version: '1.0.0',
      schema_version: 16,
    });
  });
});
