import { SecretBox } from '@bizziemoney/storage';
import { describe, expect, it, vi } from 'vitest';

import { BackupService } from './service.js';
import type {
  BackupConfigRecord,
  BackupJobRecord,
  BackupStore,
} from './store.js';
import type { BackupConfigInput } from './types.js';

const now = new Date('2026-07-28T10:00:00.000Z');

function configRecord(
  overrides: Partial<BackupConfigRecord> = {},
): BackupConfigRecord {
  return {
    backupTime: '02:00',
    dayOfMonth: null,
    dayOfWeek: null,
    destination: 'local',
    enabled: true,
    encryptionPasswordCiphertext: null,
    frequency: 'daily',
    includeAttachments: false,
    localSubfolder: 'automatic',
    nextRunAt: new Date('2026-07-29T02:00:00.000Z'),
    retentionCount: 14,
    s3Bucket: null,
    s3CredentialsCiphertext: null,
    s3Endpoint: null,
    s3ForcePathStyle: false,
    s3Prefix: null,
    s3Region: null,
    updatedAt: now,
    ...overrides,
  };
}

function backupInput(
  overrides: Partial<BackupConfigInput> = {},
): BackupConfigInput {
  return {
    backupTime: '02:00',
    dayOfMonth: null,
    dayOfWeek: null,
    destination: 'local',
    enabled: true,
    frequency: 'daily',
    includeAttachments: false,
    localSubfolder: 'automatic',
    retentionCount: 14,
    s3: null,
    ...overrides,
  };
}

function jobRecord(): BackupJobRecord {
  return {
    createdAt: now,
    errorMessage: null,
    finishedAt: null,
    id: '00000000-0000-4000-8000-000000000100',
    kind: 'backup',
    progressPercent: 0,
    progressStage: 'Queued',
    startedAt: null,
    status: 'queued',
    triggerType: 'manual',
  };
}

function createStore(overrides: Partial<BackupStore> = {}): BackupStore {
  return {
    createPreview: vi.fn(() => Promise.resolve(null)),
    enqueueBackup: vi.fn(() => Promise.resolve(jobRecord())),
    enqueueRestore: vi.fn(() => Promise.resolve(null)),
    getActiveJob: vi.fn(() => Promise.resolve(null)),
    getConfig: vi.fn(() => Promise.resolve(null)),
    getTimeZone: vi.fn(() => Promise.resolve('UTC')),
    getLastArtifact: vi.fn(() => Promise.resolve(null)),
    getPreview: vi.fn(() => Promise.resolve(null)),
    getWorkerLastSeen: vi.fn(() => Promise.resolve(null)),
    listArtifacts: vi.fn(() => Promise.resolve([])),
    listJobs: vi.fn(() => Promise.resolve([])),
    saveConfig: vi.fn<BackupStore['saveConfig']>((input) =>
      Promise.resolve(configRecord({ ...input, updatedAt: now })),
    ),
    ...overrides,
  };
}

describe('BackupService', () => {
  it('seals backup secrets and only returns safe presence flags', async () => {
    const box = new SecretBox('k'.repeat(64));
    const saveConfig = vi.fn<BackupStore['saveConfig']>((input) =>
      Promise.resolve(configRecord({ ...input, updatedAt: now })),
    );
    const service = new BackupService(
      createStore({ saveConfig }),
      { localPath: '/tmp/backups' },
      box,
      () => now,
    );

    const result = await service.saveConfig(
      '00000000-0000-4000-8000-000000000001',
      backupInput({
        destination: 's3',
        encryptionPassword: 'correct horse battery staple',
        s3: {
          accessKeyId: 'access-id',
          bucket: 'private-backups',
          endpoint: 'https://storage.example.test',
          forcePathStyle: true,
          prefix: 'bizziemoney',
          region: 'auto',
          secretAccessKey: 'secret-key',
        },
      }),
    );

    const saved = saveConfig.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    expect(saved?.encryptionPasswordCiphertext).not.toContain(
      'correct horse battery staple',
    );
    expect(saved?.s3CredentialsCiphertext).not.toContain('secret-key');
    expect(box.open(saved?.encryptionPasswordCiphertext ?? '')).toBe(
      'correct horse battery staple',
    );
    expect(JSON.parse(box.open(saved?.s3CredentialsCiphertext ?? ''))).toEqual({
      accessKeyId: 'access-id',
      secretAccessKey: 'secret-key',
    });
    expect(result.hasEncryptionPassword).toBe(true);
    expect(result.s3).toMatchObject({ hasCredentials: true });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('preserves sealed secrets when a configuration edit omits them', async () => {
    const box = new SecretBox('k'.repeat(64));
    const current = configRecord({
      encryptionPasswordCiphertext: box.seal('existing backup password'),
      s3CredentialsCiphertext: box.seal(
        JSON.stringify({
          accessKeyId: 'existing-id',
          secretAccessKey: 'existing-secret',
        }),
      ),
    });
    const saveConfig = vi.fn<BackupStore['saveConfig']>((input) =>
      Promise.resolve(configRecord({ ...input, updatedAt: now })),
    );
    const service = new BackupService(
      createStore({
        getConfig: vi.fn(() => Promise.resolve(current)),
        saveConfig,
      }),
      { localPath: '/tmp/backups' },
      box,
      () => now,
    );

    await service.saveConfig('owner-id', backupInput());

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptionPasswordCiphertext: current.encryptionPasswordCiphertext,
        s3CredentialsCiphertext: current.s3CredentialsCiphertext,
      }),
    );
  });

  it('rejects partial S3 credentials before saving anything', async () => {
    const saveConfig = vi.fn<BackupStore['saveConfig']>();
    const store = createStore({ saveConfig });
    const service = new BackupService(
      store,
      { localPath: '/tmp/backups' },
      new SecretBox('k'.repeat(64)),
      () => now,
    );

    await expect(
      service.saveConfig(
        'owner-id',
        backupInput({
          destination: 's3',
          s3: {
            accessKeyId: 'access-only',
            bucket: 'private-backups',
            forcePathStyle: false,
            endpoint: null,
            prefix: 'bizziemoney',
            region: 'auto',
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'BACKUP_S3_CREDENTIALS_INCOMPLETE',
      statusCode: 400,
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('requires configuration before accepting a manual backup job', async () => {
    const enqueueBackup = vi.fn<BackupStore['enqueueBackup']>();
    const store = createStore({ enqueueBackup });
    const service = new BackupService(
      store,
      { localPath: '/tmp/backups' },
      new SecretBox('k'.repeat(64)),
      () => now,
    );

    await expect(
      service.enqueueBackup('owner-id', 'request-id'),
    ).rejects.toMatchObject({
      code: 'BACKUP_NOT_CONFIGURED',
      statusCode: 409,
    });
    expect(enqueueBackup).not.toHaveBeenCalled();
  });

  it('reports a stale worker heartbeat as offline', async () => {
    const service = new BackupService(
      createStore({
        getConfig: vi.fn(() => Promise.resolve(configRecord())),
        getWorkerLastSeen: vi.fn(() =>
          Promise.resolve(new Date(now.getTime() - 120_001)),
        ),
      }),
      { localPath: '/tmp/backups' },
      new SecretBox('k'.repeat(64)),
      () => now,
    );

    await expect(service.getStatus('owner-id')).resolves.toMatchObject({
      configured: true,
      worker: { status: 'offline' },
    });
  });
});
