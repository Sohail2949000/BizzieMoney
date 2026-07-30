import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SecretBox } from '@bizziemoney/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  BackupArchive,
  BackupManifest,
  PreparedBackup,
} from './backup-archive';
import {
  BackupJobProcessor,
  type BackupWorkerJob,
  type BackupWorkerStore,
} from './backups';

const ownerId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-07-28T10:00:00.000Z');
const temporaryRoots: string[] = [];

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    applicationVersion: '0.7.0',
    attachmentCount: 0,
    attachments: [],
    backupCreatedAt: '2026-07-28T10:00:00.000Z',
    fileChecksums: { 'database.sql': 'a'.repeat(64) },
    formatVersion: 1,
    includesAttachments: false,
    ownerId,
    schemaVersion: 8,
    tables: { expenses: 1 },
    ...overrides,
  };
}

async function preparedBackup(
  overrides: Partial<PreparedBackup> = {},
): Promise<PreparedBackup> {
  const root = await mkdtemp(join(tmpdir(), 'bizziemoney-worker-test-'));
  temporaryRoots.push(root);
  const filePath = join(root, 'backup.bzm');
  const bytes = Buffer.from('verified backup test');
  await writeFile(filePath, bytes);
  return {
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    cleanup: vi.fn(() => Promise.resolve()),
    encrypted: false,
    filePath,
    manifest: manifest(),
    sizeBytes: bytes.length,
    ...overrides,
  };
}

function backupJob(overrides: Partial<BackupWorkerJob> = {}): BackupWorkerJob {
  return {
    attempts: 1,
    id: '00000000-0000-4000-8000-000000000010',
    kind: 'backup',
    ownerId,
    previewId: null,
    sourceArtifactId: null,
    triggerType: 'manual',
    ...overrides,
  };
}

function workerConfig() {
  return {
    backupTime: '02:00',
    dayOfMonth: null,
    dayOfWeek: null,
    destination: 'local' as const,
    encryptionPasswordCiphertext: null,
    frequency: 'daily' as const,
    includeAttachments: false,
    localSubfolder: 'automatic',
    ownerId,
    retentionCount: 14,
    s3Bucket: null,
    s3CredentialsCiphertext: null,
    s3Endpoint: null,
    s3ForcePathStyle: false,
    s3Prefix: null,
    s3Region: null,
    timeZone: 'UTC',
  };
}

function createStore(
  job: BackupWorkerJob,
  overrides: Partial<BackupWorkerStore> = {},
): BackupWorkerStore {
  let claimed = false;
  return {
    claim: vi.fn(() => {
      if (claimed) return Promise.resolve(null);
      claimed = true;
      return Promise.resolve(job);
    }),
    completeBackup: vi.fn(() => Promise.resolve()),
    completePreview: vi.fn(() => Promise.resolve()),
    completeRestore: vi.fn(() => Promise.resolve()),
    createSafetyJob: vi.fn(() =>
      Promise.resolve(
        backupJob({
          id: '00000000-0000-4000-8000-000000000020',
          triggerType: 'safety',
        }),
      ),
    ),
    fail: vi.fn(() => Promise.resolve()),
    getArtifact: vi.fn(() => Promise.resolve(null)),
    getConfig: vi.fn(() => Promise.resolve(workerConfig())),
    heartbeat: vi.fn(() => Promise.resolve()),
    listRetentionCandidates: vi.fn(() => Promise.resolve([])),
    markArtifactDeleted: vi.fn(() => Promise.resolve()),
    progress: vi.fn(() => Promise.resolve()),
    recoverStale: vi.fn(() => Promise.resolve(0)),
    scheduleDue: vi.fn(() => Promise.resolve(0)),
    setSafetyArtifact: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function createArchive(
  prepared: PreparedBackup,
  overrides: Partial<BackupArchive> = {},
): BackupArchive {
  return {
    extractArtifact: vi.fn(() =>
      Promise.reject(new Error('UNEXPECTED_EXTRACT')),
    ),
    prepareBackup: vi.fn(() => Promise.resolve(prepared)),
    restoreAttachments: vi.fn(() => Promise.resolve()),
    restoreDatabase: vi.fn(() => Promise.resolve()),
    verifyStoredObject: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('BackupJobProcessor', () => {
  it('records a verified artifact before applying retention', async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    const prepared = await preparedBackup({ cleanup });
    const events: string[] = [];
    const fail = vi.fn<BackupWorkerStore['fail']>();
    const store = createStore(backupJob(), {
      completeBackup: vi.fn(() => {
        events.push('complete');
        return Promise.resolve();
      }),
      listRetentionCandidates: vi.fn(() => {
        events.push('retention');
        return Promise.resolve([]);
      }),
      fail,
    });
    const archive = createArchive(prepared, {
      verifyStoredObject: vi.fn(() => {
        events.push('verified');
        return Promise.resolve();
      }),
    });
    const root = await mkdtemp(join(tmpdir(), 'bizziemoney-storage-test-'));
    temporaryRoots.push(root);
    const processor = new BackupJobProcessor(
      store,
      archive,
      { localPath: root },
      new SecretBox('s'.repeat(64)),
      8,
      () => now,
    );

    await expect(processor.runBatch()).resolves.toBe(1);

    expect(events).toEqual(['verified', 'complete', 'retention']);
    expect(fail).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('preserves old backups when upload verification fails', async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    const prepared = await preparedBackup({ cleanup });
    const completeBackup = vi.fn<BackupWorkerStore['completeBackup']>();
    const listRetentionCandidates =
      vi.fn<BackupWorkerStore['listRetentionCandidates']>();
    const fail = vi.fn<BackupWorkerStore['fail']>(() => Promise.resolve());
    const store = createStore(backupJob(), {
      completeBackup,
      fail,
      listRetentionCandidates,
    });
    const archive = createArchive(prepared, {
      verifyStoredObject: vi.fn(() =>
        Promise.reject(new Error('BACKUP_UPLOAD_CHECKSUM_MISMATCH')),
      ),
    });
    const root = await mkdtemp(join(tmpdir(), 'bizziemoney-storage-test-'));
    temporaryRoots.push(root);
    const processor = new BackupJobProcessor(
      store,
      archive,
      { localPath: root },
      new SecretBox('s'.repeat(64)),
      8,
      () => now,
    );

    await expect(processor.runBatch()).resolves.toBe(1);

    expect(completeBackup).not.toHaveBeenCalled();
    expect(listRetentionCandidates).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'backup' }),
      'BACKUP_UPLOAD_CHECKSUM_MISMATCH',
      'The backup upload could not be verified.',
      now,
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('creates a safety backup and rolls it back after a restore failure', async () => {
    const prepared = await preparedBackup({
      manifest: manifest({ includesAttachments: true }),
    });
    const restoreJob = backupJob({
      id: '00000000-0000-4000-8000-000000000030',
      kind: 'restore',
      previewId: '00000000-0000-4000-8000-000000000031',
      sourceArtifactId: '00000000-0000-4000-8000-000000000032',
    });
    const root = await mkdtemp(join(tmpdir(), 'bizziemoney-storage-test-'));
    temporaryRoots.push(root);
    const storageRoot = resolve(root, 'automatic');
    let safetyArtifactId: string | null = null;
    const completeBackup = vi.fn<BackupWorkerStore['completeBackup']>(
      (_job, artifact) => {
        safetyArtifactId = artifact.id;
        return Promise.resolve();
      },
    );
    const getArtifact = vi.fn<BackupWorkerStore['getArtifact']>(
      (_requestedOwnerId, artifactId) =>
        Promise.resolve({
          checksumSha256: 'b'.repeat(64),
          encrypted: false,
          id: artifactId,
          objectKey:
            artifactId === restoreJob.sourceArtifactId
              ? 'target/backup.bzm'
              : 'safety/backup.bzm',
          ownerId,
          status: 'verified' as const,
          storageProvider: 'local' as const,
          storageRoot,
        }),
    );
    const store = createStore(restoreJob, {
      completeBackup,
      getArtifact,
    });
    const targetExtraction = {
      cleanup: vi.fn(() => Promise.resolve()),
      manifest: manifest(),
      payloadDirectory: 'target-payload',
    };
    const safetyExtraction = {
      cleanup: vi.fn(() => Promise.resolve()),
      manifest: manifest({ includesAttachments: true }),
      payloadDirectory: 'safety-payload',
    };
    const extractArtifact = vi
      .fn<BackupArchive['extractArtifact']>()
      .mockResolvedValueOnce(targetExtraction)
      .mockResolvedValueOnce(safetyExtraction);
    const restoreDatabase = vi
      .fn<BackupArchive['restoreDatabase']>()
      .mockRejectedValueOnce(new Error('PSQL_FAILED'))
      .mockResolvedValueOnce();
    const restoreAttachments = vi.fn<BackupArchive['restoreAttachments']>();
    const setSafetyArtifact = vi.fn<BackupWorkerStore['setSafetyArtifact']>(
      () => Promise.resolve(),
    );
    const completeRestore = vi.fn<BackupWorkerStore['completeRestore']>();
    const fail = vi.fn<BackupWorkerStore['fail']>(() => Promise.resolve());
    Object.assign(store, {
      completeRestore,
      fail,
      setSafetyArtifact,
    });
    const archive = createArchive(prepared, {
      extractArtifact,
      restoreAttachments,
      restoreDatabase,
    });
    const processor = new BackupJobProcessor(
      store,
      archive,
      { localPath: root },
      new SecretBox('s'.repeat(64)),
      8,
      () => now,
    );

    await expect(processor.runBatch()).resolves.toBe(1);

    expect(safetyArtifactId).not.toBeNull();
    expect(setSafetyArtifact).toHaveBeenCalledWith(
      restoreJob.id,
      safetyArtifactId,
      now,
    );
    expect(restoreDatabase).toHaveBeenNthCalledWith(1, 'target-payload');
    expect(restoreDatabase).toHaveBeenNthCalledWith(2, 'safety-payload');
    expect(restoreAttachments).toHaveBeenCalledWith(
      'safety-payload',
      safetyExtraction.manifest,
    );
    expect(completeRestore).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      restoreJob,
      'RESTORE_APPLY_FAILED',
      'The restore stopped safely. The safety backup was preserved.',
      now,
    );
  });
});
