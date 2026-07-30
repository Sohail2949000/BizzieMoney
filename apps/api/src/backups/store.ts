import { randomUUID } from 'node:crypto';

import type { BizzieMoneyDatabase } from '@bizziemoney/database';

export interface BackupConfigRecord {
  backupTime: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  destination: 'local' | 's3';
  enabled: boolean;
  encryptionPasswordCiphertext: string | null;
  frequency: 'daily' | 'monthly' | 'weekly';
  includeAttachments: boolean;
  localSubfolder: string;
  nextRunAt: Date | null;
  retentionCount: number;
  s3Bucket: string | null;
  s3CredentialsCiphertext: string | null;
  s3Endpoint: string | null;
  s3ForcePathStyle: boolean;
  s3Prefix: string | null;
  s3Region: string | null;
  updatedAt: Date;
}

export interface SaveBackupConfigRecord extends Omit<
  BackupConfigRecord,
  'updatedAt'
> {
  ownerId: string;
}

export interface BackupJobRecord {
  createdAt: Date;
  errorMessage: string | null;
  finishedAt: Date | null;
  id: string;
  kind: 'backup' | 'preview' | 'restore';
  progressPercent: number;
  progressStage: string;
  startedAt: Date | null;
  status: 'failed' | 'processing' | 'queued' | 'succeeded';
  triggerType: 'manual' | 'safety' | 'scheduled';
}

export interface BackupArtifactRecord {
  applicationVersion: string;
  attachmentCount: number;
  backupCreatedAt: Date;
  checksumSha256: string;
  encrypted: boolean;
  fileName: string;
  id: string;
  includesAttachments: boolean;
  schemaVersion: number;
  sizeBytes: string;
  storageProvider: 'local' | 's3';
}

export interface RestorePreviewRecord {
  artifactId: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  job: BackupJobRecord;
  status: 'failed' | 'pending' | 'ready';
  summary: Record<string, unknown>;
  usedAt: Date | null;
}

export interface BackupStore {
  createPreview(
    ownerId: string,
    artifactId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<RestorePreviewRecord | null>;
  enqueueBackup(
    ownerId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<BackupJobRecord>;
  enqueueRestore(
    ownerId: string,
    previewId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<BackupJobRecord | null>;
  getActiveJob(ownerId: string): Promise<BackupJobRecord | null>;
  getConfig(ownerId: string): Promise<BackupConfigRecord | null>;
  getTimeZone(ownerId: string): Promise<string>;
  getPreview(
    ownerId: string,
    previewId: string,
  ): Promise<RestorePreviewRecord | null>;
  getLastArtifact(ownerId: string): Promise<BackupArtifactRecord | null>;
  getWorkerLastSeen(): Promise<Date | null>;
  listArtifacts(ownerId: string): Promise<BackupArtifactRecord[]>;
  listJobs(ownerId: string): Promise<BackupJobRecord[]>;
  saveConfig(input: SaveBackupConfigRecord): Promise<BackupConfigRecord>;
}

function toConfigRecord(row: {
  backup_time: string;
  day_of_month: number | null;
  day_of_week: number | null;
  destination: 'local' | 's3';
  enabled: boolean;
  encryption_password_ciphertext: string | null;
  frequency: 'daily' | 'monthly' | 'weekly';
  include_attachments: boolean;
  local_subfolder: string;
  next_run_at: Date | null;
  retention_count: number;
  s3_bucket: string | null;
  s3_credentials_ciphertext: string | null;
  s3_endpoint: string | null;
  s3_force_path_style: boolean;
  s3_prefix: string | null;
  s3_region: string | null;
  updated_at: Date;
}): BackupConfigRecord {
  return {
    backupTime: row.backup_time.slice(0, 5),
    dayOfMonth: row.day_of_month,
    dayOfWeek: row.day_of_week,
    destination: row.destination,
    enabled: row.enabled,
    encryptionPasswordCiphertext: row.encryption_password_ciphertext,
    frequency: row.frequency,
    includeAttachments: row.include_attachments,
    localSubfolder: row.local_subfolder,
    nextRunAt: row.next_run_at,
    retentionCount: row.retention_count,
    s3Bucket: row.s3_bucket,
    s3CredentialsCiphertext: row.s3_credentials_ciphertext,
    s3Endpoint: row.s3_endpoint,
    s3ForcePathStyle: row.s3_force_path_style,
    s3Prefix: row.s3_prefix,
    s3Region: row.s3_region,
    updatedAt: row.updated_at,
  };
}

function toJobRecord(row: {
  created_at: Date;
  error_message: string | null;
  finished_at: Date | null;
  id: string;
  kind: 'backup' | 'preview' | 'restore';
  progress_percent: number;
  progress_stage: string;
  started_at: Date | null;
  status: 'failed' | 'processing' | 'queued' | 'succeeded';
  trigger_type: 'manual' | 'safety' | 'scheduled';
}): BackupJobRecord {
  return {
    createdAt: row.created_at,
    errorMessage: row.error_message,
    finishedAt: row.finished_at,
    id: row.id,
    kind: row.kind,
    progressPercent: row.progress_percent,
    progressStage: row.progress_stage,
    startedAt: row.started_at,
    status: row.status,
    triggerType: row.trigger_type,
  };
}

function toArtifactRecord(row: {
  application_version: string;
  attachment_count: number;
  backup_created_at: Date;
  checksum_sha256: string;
  encrypted: boolean;
  file_name: string;
  id: string;
  includes_attachments: boolean;
  schema_version: number;
  size_bytes: string;
  storage_provider: 'local' | 's3';
}): BackupArtifactRecord {
  return {
    applicationVersion: row.application_version,
    attachmentCount: row.attachment_count,
    backupCreatedAt: row.backup_created_at,
    checksumSha256: row.checksum_sha256,
    encrypted: row.encrypted,
    fileName: row.file_name,
    id: row.id,
    includesAttachments: row.includes_attachments,
    schemaVersion: row.schema_version,
    sizeBytes: row.size_bytes,
    storageProvider: row.storage_provider,
  };
}

const jobSelection = [
  'created_at',
  'error_message',
  'finished_at',
  'id',
  'kind',
  'progress_percent',
  'progress_stage',
  'started_at',
  'status',
  'trigger_type',
] as const;

export class PostgresBackupStore implements BackupStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getConfig(ownerId: string): Promise<BackupConfigRecord | null> {
    const row = await this.database
      .selectFrom('backup_configs')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .executeTakeFirst();
    return row ? toConfigRecord(row) : null;
  }

  async getTimeZone(ownerId: string): Promise<string> {
    const settings = await this.database
      .selectFrom('app_settings')
      .select('time_zone')
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    return settings.time_zone;
  }

  async saveConfig(input: SaveBackupConfigRecord): Promise<BackupConfigRecord> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('backup_configs')
        .values({
          backup_time: input.backupTime,
          day_of_month: input.dayOfMonth,
          day_of_week: input.dayOfWeek,
          destination: input.destination,
          enabled: input.enabled,
          encryption_password_ciphertext: input.encryptionPasswordCiphertext,
          frequency: input.frequency,
          include_attachments: input.includeAttachments,
          local_subfolder: input.localSubfolder,
          next_run_at: input.nextRunAt,
          owner_id: input.ownerId,
          retention_count: input.retentionCount,
          s3_bucket: input.s3Bucket,
          s3_credentials_ciphertext: input.s3CredentialsCiphertext,
          s3_endpoint: input.s3Endpoint,
          s3_force_path_style: input.s3ForcePathStyle,
          s3_prefix: input.s3Prefix,
          s3_region: input.s3Region,
        })
        .onConflict((conflict) =>
          conflict.column('owner_id').doUpdateSet({
            backup_time: input.backupTime,
            day_of_month: input.dayOfMonth,
            day_of_week: input.dayOfWeek,
            destination: input.destination,
            enabled: input.enabled,
            encryption_password_ciphertext: input.encryptionPasswordCiphertext,
            frequency: input.frequency,
            include_attachments: input.includeAttachments,
            local_subfolder: input.localSubfolder,
            next_run_at: input.nextRunAt,
            retention_count: input.retentionCount,
            s3_bucket: input.s3Bucket,
            s3_credentials_ciphertext: input.s3CredentialsCiphertext,
            s3_endpoint: input.s3Endpoint,
            s3_force_path_style: input.s3ForcePathStyle,
            s3_prefix: input.s3Prefix,
            s3_region: input.s3Region,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values({
          event_type: 'backup.settings_changed',
          id: randomUUID(),
          metadata: {
            destination: input.destination,
            enabled: input.enabled,
            frequency: input.frequency,
            includeAttachments: input.includeAttachments,
            retentionCount: input.retentionCount,
          },
          owner_id: input.ownerId,
        })
        .execute();
      return toConfigRecord(row);
    });
  }

  async enqueueBackup(
    ownerId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<BackupJobRecord> {
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto('backup_jobs')
        .values({
          id: randomUUID(),
          idempotency_key: idempotencyKey,
          kind: 'backup',
          owner_id: ownerId,
          scheduled_at: now,
          trigger_type: 'manual',
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning(jobSelection)
        .executeTakeFirst();
      if (inserted) return toJobRecord(inserted);
      const existing = await transaction
        .selectFrom('backup_jobs')
        .select(jobSelection)
        .where('owner_id', '=', ownerId)
        .where('idempotency_key', '=', idempotencyKey)
        .where('kind', '=', 'backup')
        .executeTakeFirstOrThrow();
      return toJobRecord(existing);
    });
  }

  async createPreview(
    ownerId: string,
    artifactId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<RestorePreviewRecord | null> {
    return this.database.transaction().execute(async (transaction) => {
      const existingJob = await transaction
        .selectFrom('backup_jobs')
        .select(['preview_id'])
        .where('owner_id', '=', ownerId)
        .where('idempotency_key', '=', idempotencyKey)
        .where('kind', '=', 'preview')
        .executeTakeFirst();
      if (existingJob?.preview_id) {
        return this.getPreviewWithDatabase(
          transaction,
          ownerId,
          existingJob.preview_id,
        );
      }

      const artifact = await transaction
        .selectFrom('backup_artifacts')
        .select('id')
        .where('id', '=', artifactId)
        .where('owner_id', '=', ownerId)
        .where('status', '=', 'verified')
        .executeTakeFirst();
      if (!artifact) return null;

      const jobId = randomUUID();
      const previewId = randomUUID();
      await transaction
        .insertInto('backup_jobs')
        .values({
          id: jobId,
          idempotency_key: idempotencyKey,
          kind: 'preview',
          owner_id: ownerId,
          scheduled_at: now,
          source_artifact_id: artifactId,
          trigger_type: 'manual',
        })
        .execute();
      await transaction
        .insertInto('restore_previews')
        .values({
          artifact_id: artifactId,
          expires_at: new Date(now.getTime() + 24 * 60 * 60_000),
          id: previewId,
          job_id: jobId,
          owner_id: ownerId,
        })
        .execute();
      await transaction
        .updateTable('backup_jobs')
        .set({ preview_id: previewId })
        .where('id', '=', jobId)
        .execute();
      return this.getPreviewWithDatabase(transaction, ownerId, previewId);
    });
  }

  async enqueueRestore(
    ownerId: string,
    previewId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<BackupJobRecord | null> {
    return this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom('backup_jobs')
        .select(jobSelection)
        .where('owner_id', '=', ownerId)
        .where('idempotency_key', '=', idempotencyKey)
        .where('kind', '=', 'restore')
        .executeTakeFirst();
      if (existing) return toJobRecord(existing);

      const preview = await transaction
        .selectFrom('restore_previews')
        .select(['artifact_id'])
        .where('id', '=', previewId)
        .where('owner_id', '=', ownerId)
        .where('status', '=', 'ready')
        .where('used_at', 'is', null)
        .where('expires_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (!preview) return null;

      const inserted = await transaction
        .insertInto('backup_jobs')
        .values({
          id: randomUUID(),
          idempotency_key: idempotencyKey,
          kind: 'restore',
          owner_id: ownerId,
          preview_id: previewId,
          scheduled_at: now,
          source_artifact_id: preview.artifact_id,
          trigger_type: 'manual',
        })
        .returning(jobSelection)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('restore_previews')
        .set({ updated_at: now, used_at: now })
        .where('id', '=', previewId)
        .execute();
      return toJobRecord(inserted);
    });
  }

  async getActiveJob(ownerId: string): Promise<BackupJobRecord | null> {
    const row = await this.database
      .selectFrom('backup_jobs')
      .select(jobSelection)
      .where('owner_id', '=', ownerId)
      .where('status', 'in', ['queued', 'processing'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? toJobRecord(row) : null;
  }

  async getLastArtifact(ownerId: string): Promise<BackupArtifactRecord | null> {
    const row = await this.database
      .selectFrom('backup_artifacts')
      .select([
        'application_version',
        'attachment_count',
        'backup_created_at',
        'checksum_sha256',
        'encrypted',
        'file_name',
        'id',
        'includes_attachments',
        'schema_version',
        'size_bytes',
        'storage_provider',
      ])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'verified')
      .orderBy('backup_created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? toArtifactRecord(row) : null;
  }

  async getWorkerLastSeen(): Promise<Date | null> {
    const row = await this.database
      .selectFrom('worker_heartbeats')
      .select('last_seen_at')
      .where('worker_name', '=', 'backup-worker')
      .executeTakeFirst();
    return row?.last_seen_at ?? null;
  }

  async listJobs(ownerId: string): Promise<BackupJobRecord[]> {
    const rows = await this.database
      .selectFrom('backup_jobs')
      .select(jobSelection)
      .where('owner_id', '=', ownerId)
      .where('trigger_type', '!=', 'safety')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return rows.map(toJobRecord);
  }

  async listArtifacts(ownerId: string): Promise<BackupArtifactRecord[]> {
    const rows = await this.database
      .selectFrom('backup_artifacts')
      .select([
        'application_version',
        'attachment_count',
        'backup_created_at',
        'checksum_sha256',
        'encrypted',
        'file_name',
        'id',
        'includes_attachments',
        'schema_version',
        'size_bytes',
        'storage_provider',
      ])
      .where('owner_id', '=', ownerId)
      .where('status', '=', 'verified')
      .orderBy('backup_created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(30)
      .execute();
    return rows.map(toArtifactRecord);
  }

  async getPreview(
    ownerId: string,
    previewId: string,
  ): Promise<RestorePreviewRecord | null> {
    return this.getPreviewWithDatabase(this.database, ownerId, previewId);
  }

  private async getPreviewWithDatabase(
    database: BizzieMoneyDatabase,
    ownerId: string,
    previewId: string,
  ): Promise<RestorePreviewRecord | null> {
    const row = await database
      .selectFrom('restore_previews as preview')
      .innerJoin('backup_jobs as job', 'job.id', 'preview.job_id')
      .select([
        'preview.artifact_id',
        'preview.created_at as preview_created_at',
        'preview.expires_at',
        'preview.id as preview_id',
        'preview.status as preview_status',
        'preview.summary',
        'preview.used_at',
        'job.created_at',
        'job.error_message',
        'job.finished_at',
        'job.id',
        'job.kind',
        'job.progress_percent',
        'job.progress_stage',
        'job.started_at',
        'job.status',
        'job.trigger_type',
      ])
      .where('preview.id', '=', previewId)
      .where('preview.owner_id', '=', ownerId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      artifactId: row.artifact_id,
      createdAt: row.preview_created_at,
      expiresAt: row.expires_at,
      id: row.preview_id,
      job: toJobRecord(row),
      status: row.preview_status,
      summary: row.summary,
      usedAt: row.used_at,
    };
  }
}
