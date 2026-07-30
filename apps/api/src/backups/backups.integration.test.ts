import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  runMigrations,
  type BizzieMoneyDatabase,
} from '@bizziemoney/database';
import { SecretBox } from '@bizziemoney/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/service.js';
import { PostgresAuthStore } from '../auth/store.js';
import { BackupService } from './service.js';
import { PostgresBackupStore } from './store.js';

const baseConnectionString = process.env.TEST_DATABASE_URL;
const integrationDescribe = baseConnectionString ? describe : describe.skip;
const schemaName = `bm_backups_${randomUUID().replaceAll('-', '')}`;
let adminDatabase: BizzieMoneyDatabase | undefined;
let testDatabase: BizzieMoneyDatabase | undefined;
let service: BackupService;
let ownerId = '';

function schemaConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

integrationDescribe('PostgreSQL backups', () => {
  beforeAll(async () => {
    adminDatabase = createDatabase({
      applicationName: 'bizziemoney-backups-integration-admin',
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
      applicationName: 'bizziemoney-backups-integration',
      connectionString: isolatedConnectionString,
      maxConnections: 2,
    });
    const auth = await new AuthService(
      new PostgresAuthStore(testDatabase),
      'backup-integration-session-secret-long-enough',
      24,
    ).setupOwner('Jamie', 'jamie@example.com', 'backup-integration-password', {
      ipAddress: '127.0.0.1',
      userAgent: 'Integration test',
    });
    ownerId = auth.owner.id;
    service = new BackupService(
      new PostgresBackupStore(testDatabase),
      { localPath: '/tmp/bizziemoney-backups' },
      new SecretBox('backup-integration-sealing-key'.repeat(2)),
      () => new Date('2026-07-28T10:00:00.000Z'),
    );
  }, 30_000);

  afterAll(async () => {
    await testDatabase?.destroy();
    if (adminDatabase) {
      await adminDatabase.schema.dropSchema(schemaName).cascade().execute();
      await adminDatabase.destroy();
    }
  });

  it('persists redacted config and idempotent backup/preview/restore jobs', async () => {
    const config = await service.saveConfig(ownerId, {
      backupTime: '02:00',
      dayOfMonth: null,
      dayOfWeek: null,
      destination: 'local',
      enabled: true,
      encryptionPassword: 'archive-password-long-enough',
      frequency: 'daily',
      includeAttachments: true,
      localSubfolder: 'automatic',
      retentionCount: 7,
      s3: null,
    });
    expect(config).toMatchObject({
      enabled: true,
      hasEncryptionPassword: true,
    });
    expect(new Date(config.nextRunAt ?? 0).getTime()).toBeGreaterThan(
      new Date('2026-07-28T10:00:00.000Z').getTime(),
    );
    expect(JSON.stringify(config)).not.toContain(
      'archive-password-long-enough',
    );

    const requestId = randomUUID();
    const backup = await service.enqueueBackup(ownerId, requestId);
    const backupReplay = await service.enqueueBackup(ownerId, requestId);
    expect(backupReplay.id).toBe(backup.id);

    const completedAt = new Date('2026-07-28T10:01:00.000Z');
    await testDatabase!
      .updateTable('backup_jobs')
      .set({
        finished_at: completedAt,
        progress_percent: 100,
        progress_stage: 'Verified',
        status: 'succeeded',
      })
      .where('id', '=', backup.id)
      .execute();
    const artifactId = randomUUID();
    await testDatabase!
      .insertInto('backup_artifacts')
      .values({
        application_version: '0.7.0',
        attachment_count: 0,
        backup_created_at: completedAt,
        checksum_sha256: 'a'.repeat(64),
        encrypted: true,
        file_name: 'BizzieMoney-test.bzm.enc',
        id: artifactId,
        includes_attachments: true,
        job_id: backup.id,
        manifest_summary: { tables: { expenses: 0 } },
        object_key: `${ownerId}/test/backup.bzm.enc`,
        owner_id: ownerId,
        schema_version: 8,
        size_bytes: '100',
        status: 'verified',
        storage_provider: 'local',
        storage_root: '/tmp/bizziemoney-backups/automatic',
        verified_at: completedAt,
      })
      .execute();

    const previewRequestId = randomUUID();
    const preview = await service.createRestorePreview(
      ownerId,
      artifactId,
      previewRequestId,
    );
    const previewReplay = await service.createRestorePreview(
      ownerId,
      artifactId,
      previewRequestId,
    );
    expect(previewReplay.id).toBe(preview.id);
    await expect(
      service.createRestorePreview(randomUUID(), artifactId, randomUUID()),
    ).rejects.toMatchObject({ code: 'BACKUP_ARTIFACT_UNAVAILABLE' });

    await testDatabase!
      .updateTable('restore_previews')
      .set({
        status: 'ready',
        summary: {
          applicationVersion: '0.7.0',
          attachmentCount: 0,
          backupCreatedAt: completedAt.toISOString(),
          encrypted: true,
          includesAttachments: true,
          schemaVersion: 8,
          tables: { expenses: 0 },
          warnings: [],
        },
      })
      .where('id', '=', preview.id)
      .execute();
    await testDatabase!
      .updateTable('backup_jobs')
      .set({
        finished_at: completedAt,
        progress_percent: 100,
        progress_stage: 'Preview ready',
        status: 'succeeded',
      })
      .where('id', '=', preview.job.id)
      .execute();

    const restoreRequestId = randomUUID();
    const restore = await service.enqueueRestore(
      ownerId,
      preview.id,
      restoreRequestId,
    );
    const restoreReplay = await service.enqueueRestore(
      ownerId,
      preview.id,
      restoreRequestId,
    );
    expect(restoreReplay.id).toBe(restore.id);
    await expect(
      service.enqueueRestore(ownerId, preview.id, randomUUID()),
    ).rejects.toMatchObject({ code: 'RESTORE_PREVIEW_EXPIRED' });

    const auditEvents = await testDatabase!
      .selectFrom('audit_events')
      .select(['event_type', 'metadata'])
      .where('owner_id', '=', ownerId)
      .where('event_type', '=', 'backup.settings_changed')
      .execute();
    expect(auditEvents).toHaveLength(1);
    expect(JSON.stringify(auditEvents)).not.toContain(
      'archive-password-long-enough',
    );
  }, 30_000);
});
