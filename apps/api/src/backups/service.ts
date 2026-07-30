import {
  createBackupStorage,
  type BackupStorageBaseConfig,
  type S3StorageConfig,
  type SecretBox,
} from '@bizziemoney/storage';
import { nextBackupRun } from '@bizziemoney/shared';

import { AppError } from '../errors';
import type {
  BackupArtifactRecord,
  BackupConfigRecord,
  BackupJobRecord,
  BackupStore,
  RestorePreviewRecord,
} from './store';
import type {
  BackupArtifactSummary,
  BackupConfigInput,
  BackupHistory,
  BackupJobSummary,
  BackupServiceContract,
  BackupStatus,
  PublicBackupConfig,
  RestorePreview,
  RestorePreviewSummary,
} from './types';

interface StoredS3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function toPublicConfig(record: BackupConfigRecord): PublicBackupConfig {
  return {
    backupTime: record.backupTime,
    dayOfMonth: record.dayOfMonth,
    dayOfWeek: record.dayOfWeek,
    destination: record.destination,
    enabled: record.enabled,
    frequency: record.frequency,
    hasEncryptionPassword: Boolean(record.encryptionPasswordCiphertext),
    includeAttachments: record.includeAttachments,
    localSubfolder: record.localSubfolder,
    nextRunAt: record.nextRunAt?.toISOString() ?? null,
    retentionCount: record.retentionCount,
    s3:
      record.s3Bucket && record.s3Region && record.s3Prefix
        ? {
            bucket: record.s3Bucket,
            endpoint: record.s3Endpoint,
            forcePathStyle: record.s3ForcePathStyle,
            hasCredentials: Boolean(record.s3CredentialsCiphertext),
            prefix: record.s3Prefix,
            region: record.s3Region,
          }
        : null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toJobSummary(record: BackupJobRecord): BackupJobSummary {
  return {
    createdAt: record.createdAt.toISOString(),
    errorMessage: record.errorMessage,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    id: record.id,
    kind: record.kind,
    progressPercent: record.progressPercent,
    progressStage: record.progressStage,
    startedAt: record.startedAt?.toISOString() ?? null,
    status: record.status,
    triggerType: record.triggerType,
  };
}

function toArtifactSummary(
  record: BackupArtifactRecord,
): BackupArtifactSummary {
  return {
    applicationVersion: record.applicationVersion,
    attachmentCount: record.attachmentCount,
    backupCreatedAt: record.backupCreatedAt.toISOString(),
    checksumSha256: record.checksumSha256,
    encrypted: record.encrypted,
    fileName: record.fileName,
    id: record.id,
    includesAttachments: record.includesAttachments,
    schemaVersion: record.schemaVersion,
    sizeBytes: record.sizeBytes,
    storageProvider: record.storageProvider,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function previewSummary(
  value: Record<string, unknown>,
): RestorePreviewSummary | null {
  if (
    typeof value.applicationVersion !== 'string' ||
    typeof value.attachmentCount !== 'number' ||
    typeof value.backupCreatedAt !== 'string' ||
    typeof value.encrypted !== 'boolean' ||
    typeof value.includesAttachments !== 'boolean' ||
    typeof value.schemaVersion !== 'number' ||
    !isRecord(value.tables) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }
  const tables = Object.fromEntries(
    Object.entries(value.tables).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
  const warnings = value.warnings.filter(
    (warning): warning is string => typeof warning === 'string',
  );
  return {
    applicationVersion: value.applicationVersion,
    attachmentCount: value.attachmentCount,
    backupCreatedAt: value.backupCreatedAt,
    encrypted: value.encrypted,
    includesAttachments: value.includesAttachments,
    schemaVersion: value.schemaVersion,
    tables,
    warnings,
  };
}

function toRestorePreview(record: RestorePreviewRecord): RestorePreview {
  return {
    artifactId: record.artifactId,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    id: record.id,
    job: toJobSummary(record.job),
    status: record.status,
    summary: record.status === 'ready' ? previewSummary(record.summary) : null,
    usedAt: record.usedAt?.toISOString() ?? null,
  };
}

function safeS3Credentials(
  box: SecretBox,
  ciphertext: string | null,
): StoredS3Credentials | null {
  if (!ciphertext) return null;
  try {
    const parsed = JSON.parse(box.open(ciphertext)) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.accessKeyId !== 'string' ||
      typeof parsed.secretAccessKey !== 'string'
    ) {
      throw new Error('invalid');
    }
    return {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
    };
  } catch {
    throw new AppError({
      code: 'BACKUP_CREDENTIALS_UNAVAILABLE',
      message:
        'The saved backup credentials could not be opened. Save them again.',
      statusCode: 409,
    });
  }
}

export class BackupService implements BackupServiceContract {
  constructor(
    private readonly store: BackupStore,
    private readonly storageBase: BackupStorageBaseConfig,
    private readonly secretBox: SecretBox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getConfig(ownerId: string): Promise<PublicBackupConfig | null> {
    const record = await this.store.getConfig(ownerId);
    return record ? toPublicConfig(record) : null;
  }

  async saveConfig(
    ownerId: string,
    input: BackupConfigInput,
  ): Promise<PublicBackupConfig> {
    const [current, timeZone] = await Promise.all([
      this.store.getConfig(ownerId),
      this.store.getTimeZone(ownerId),
    ]);
    const encryptionPasswordCiphertext =
      input.encryptionPassword === undefined
        ? (current?.encryptionPasswordCiphertext ?? null)
        : input.encryptionPassword
          ? this.secretBox.seal(input.encryptionPassword)
          : null;

    const suppliedAccessKey = input.s3?.accessKeyId?.trim();
    const suppliedSecretKey = input.s3?.secretAccessKey?.trim();
    if (Boolean(suppliedAccessKey) !== Boolean(suppliedSecretKey)) {
      throw new AppError({
        code: 'BACKUP_S3_CREDENTIALS_INCOMPLETE',
        message: 'Enter both the S3 access key and secret key.',
        statusCode: 400,
      });
    }
    const s3CredentialsCiphertext =
      suppliedAccessKey && suppliedSecretKey
        ? this.secretBox.seal(
            JSON.stringify({
              accessKeyId: suppliedAccessKey,
              secretAccessKey: suppliedSecretKey,
            } satisfies StoredS3Credentials),
          )
        : (current?.s3CredentialsCiphertext ?? null);

    if (
      input.destination === 's3' &&
      (!input.s3 || !input.s3.bucket || !input.s3.prefix)
    ) {
      throw new AppError({
        code: 'BACKUP_S3_CONFIGURATION_INCOMPLETE',
        message: 'Enter the S3 bucket, region, and backup prefix.',
        statusCode: 400,
      });
    }

    const saved = await this.store.saveConfig({
      backupTime: input.backupTime,
      dayOfMonth: input.frequency === 'monthly' ? input.dayOfMonth : null,
      dayOfWeek: input.frequency === 'weekly' ? input.dayOfWeek : null,
      destination: input.destination,
      enabled: input.enabled,
      encryptionPasswordCiphertext,
      frequency: input.frequency,
      includeAttachments: input.includeAttachments,
      localSubfolder: input.localSubfolder,
      nextRunAt: input.enabled
        ? nextBackupRun(
            {
              backupTime: input.backupTime,
              dayOfMonth: input.dayOfMonth,
              dayOfWeek: input.dayOfWeek,
              frequency: input.frequency,
            },
            this.now(),
            timeZone,
          )
        : null,
      ownerId,
      retentionCount: input.retentionCount,
      s3Bucket: input.s3?.bucket ?? null,
      s3CredentialsCiphertext,
      s3Endpoint: input.s3?.endpoint ?? null,
      s3ForcePathStyle: input.s3?.forcePathStyle ?? false,
      s3Prefix: input.s3?.prefix ?? null,
      s3Region: input.s3?.region ?? null,
    });
    return toPublicConfig(saved);
  }

  async testDestination(
    ownerId: string,
    input: BackupConfigInput,
  ): Promise<{ message: string }> {
    if (input.destination === 'local') {
      const storage = createBackupStorage(this.storageBase, {
        localSubfolder: input.localSubfolder,
        provider: 'local',
      });
      await storage.testConnection();
      return { message: 'The local backup folder is ready.' };
    }

    if (!input.s3) {
      throw new AppError({
        code: 'BACKUP_S3_CONFIGURATION_INCOMPLETE',
        message: 'Enter the S3 destination before testing it.',
        statusCode: 400,
      });
    }
    const existing = await this.store.getConfig(ownerId);
    const supplied =
      input.s3.accessKeyId?.trim() && input.s3.secretAccessKey?.trim()
        ? {
            accessKeyId: input.s3.accessKeyId.trim(),
            secretAccessKey: input.s3.secretAccessKey.trim(),
          }
        : safeS3Credentials(
            this.secretBox,
            existing?.s3CredentialsCiphertext ?? null,
          );
    const s3Config: S3StorageConfig = {
      accessKeyId: supplied?.accessKeyId,
      bucket: input.s3.bucket,
      endpoint: input.s3.endpoint ?? undefined,
      forcePathStyle: input.s3.forcePathStyle,
      prefix: input.s3.prefix.replace(/^\/+|\/+$/g, ''),
      region: input.s3.region,
      secretAccessKey: supplied?.secretAccessKey,
    };
    await createBackupStorage(this.storageBase, {
      provider: 's3',
      s3: s3Config,
    }).testConnection();
    return { message: 'The S3-compatible backup destination is reachable.' };
  }

  async enqueueBackup(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<BackupJobSummary> {
    const config = await this.store.getConfig(ownerId);
    if (!config) {
      throw new AppError({
        code: 'BACKUP_NOT_CONFIGURED',
        message: 'Save your backup settings before starting a backup.',
        statusCode: 409,
      });
    }
    const job = await this.store.enqueueBackup(
      ownerId,
      `backup:${idempotencyKey}`,
      this.now(),
    );
    return toJobSummary(job);
  }

  async createRestorePreview(
    ownerId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<RestorePreview> {
    const preview = await this.store.createPreview(
      ownerId,
      artifactId,
      `preview:${artifactId}:${idempotencyKey}`,
      this.now(),
    );
    if (!preview) {
      throw new AppError({
        code: 'BACKUP_ARTIFACT_UNAVAILABLE',
        message: 'That verified backup is no longer available.',
        statusCode: 404,
      });
    }
    return toRestorePreview(preview);
  }

  async getPreview(
    ownerId: string,
    previewId: string,
  ): Promise<RestorePreview> {
    const preview = await this.store.getPreview(ownerId, previewId);
    if (!preview) {
      throw new AppError({
        code: 'RESTORE_PREVIEW_UNAVAILABLE',
        message: 'That restore preview is no longer available.',
        statusCode: 404,
      });
    }
    return toRestorePreview(preview);
  }

  async enqueueRestore(
    ownerId: string,
    previewId: string,
    idempotencyKey: string,
  ): Promise<BackupJobSummary> {
    const job = await this.store.enqueueRestore(
      ownerId,
      previewId,
      `restore:${previewId}:${idempotencyKey}`,
      this.now(),
    );
    if (!job) {
      throw new AppError({
        code: 'RESTORE_PREVIEW_EXPIRED',
        message: 'Create a fresh restore preview before restoring this backup.',
        statusCode: 409,
      });
    }
    return toJobSummary(job);
  }

  async getStatus(ownerId: string): Promise<BackupStatus> {
    const [config, activeJob, lastArtifact, workerLastSeen] = await Promise.all(
      [
        this.store.getConfig(ownerId),
        this.store.getActiveJob(ownerId),
        this.store.getLastArtifact(ownerId),
        this.store.getWorkerLastSeen(),
      ],
    );
    const workerAge = workerLastSeen
      ? this.now().getTime() - workerLastSeen.getTime()
      : null;
    return {
      activeJob: activeJob ? toJobSummary(activeJob) : null,
      configured: Boolean(config),
      config: config ? toPublicConfig(config) : null,
      lastSuccessfulBackup: lastArtifact
        ? toArtifactSummary(lastArtifact)
        : null,
      worker: {
        lastSeenAt: workerLastSeen?.toISOString() ?? null,
        status:
          workerAge === null
            ? 'unknown'
            : workerAge <= 2 * 60_000
              ? 'online'
              : 'offline',
      },
    };
  }

  async listHistory(ownerId: string): Promise<BackupHistory> {
    const [jobs, artifacts] = await Promise.all([
      this.store.listJobs(ownerId),
      this.store.listArtifacts(ownerId),
    ]);
    return {
      artifacts: artifacts.map(toArtifactSummary),
      jobs: jobs.map(toJobSummary),
    };
  }
}
