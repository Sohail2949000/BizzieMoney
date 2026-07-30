import { randomUUID } from 'node:crypto';

import { sql, type BizzieMoneyDatabase } from '@bizziemoney/database';
import { APP_VERSION, nextBackupRun } from '@bizziemoney/shared';
import {
  createBackupStorage,
  type AttachmentStorage,
  type BackupStorageBaseConfig,
  type S3StorageConfig,
  type SecretBox,
} from '@bizziemoney/storage';

import {
  type BackupArchive,
  type BackupManifest,
  type PreparedBackup,
} from './backup-archive';

const STALE_JOB_MILLISECONDS = 30 * 60_000;
const MAX_JOB_ATTEMPTS = 3;

interface WorkerBackupConfig {
  backupTime: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  destination: 'local' | 's3';
  encryptionPasswordCiphertext: string | null;
  frequency: 'daily' | 'monthly' | 'weekly';
  includeAttachments: boolean;
  localSubfolder: string;
  ownerId: string;
  retentionCount: number;
  s3Bucket: string | null;
  s3CredentialsCiphertext: string | null;
  s3Endpoint: string | null;
  s3ForcePathStyle: boolean;
  s3Prefix: string | null;
  s3Region: string | null;
  timeZone: string;
}

export interface BackupWorkerJob {
  attempts: number;
  id: string;
  kind: 'backup' | 'preview' | 'restore';
  ownerId: string;
  previewId: string | null;
  sourceArtifactId: string | null;
  triggerType: 'manual' | 'safety' | 'scheduled';
}

interface WorkerArtifact {
  checksumSha256: string;
  encrypted: boolean;
  id: string;
  objectKey: string;
  ownerId: string;
  status: 'deleted' | 'invalid' | 'verified';
  storageProvider: 'local' | 's3';
  storageRoot: string;
}

export interface CompletedArtifact {
  applicationVersion: string;
  attachmentCount: number;
  backupCreatedAt: Date;
  checksumSha256: string;
  encrypted: boolean;
  fileName: string;
  id: string;
  includesAttachments: boolean;
  manifestSummary: Record<string, unknown>;
  objectKey: string;
  schemaVersion: number;
  sizeBytes: number;
  storageProvider: 'local' | 's3';
  storageRoot: string;
}

interface RetentionArtifact {
  id: string;
  objectKey: string;
  storageProvider: 'local' | 's3';
  storageRoot: string;
}

interface BackupCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupWorkerStore {
  claim(now: Date): Promise<BackupWorkerJob | null>;
  completeBackup(
    job: BackupWorkerJob,
    artifact: CompletedArtifact,
    now: Date,
  ): Promise<void>;
  completePreview(
    job: BackupWorkerJob,
    summary: Record<string, unknown>,
    now: Date,
  ): Promise<void>;
  completeRestore(job: BackupWorkerJob, now: Date): Promise<void>;
  createSafetyJob(
    parentJob: BackupWorkerJob,
    now: Date,
  ): Promise<BackupWorkerJob>;
  fail(
    job: BackupWorkerJob,
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void>;
  getArtifact(
    ownerId: string,
    artifactId: string,
  ): Promise<WorkerArtifact | null>;
  getConfig(ownerId: string): Promise<WorkerBackupConfig | null>;
  heartbeat(now: Date): Promise<void>;
  listRetentionCandidates(
    ownerId: string,
    retentionCount: number,
  ): Promise<RetentionArtifact[]>;
  markArtifactDeleted(artifactId: string, now: Date): Promise<void>;
  progress(
    jobId: string,
    percent: number,
    stage: string,
    now: Date,
  ): Promise<void>;
  recoverStale(now: Date): Promise<number>;
  scheduleDue(now: Date): Promise<number>;
  setSafetyArtifact(
    restoreJobId: string,
    artifactId: string,
    now: Date,
  ): Promise<void>;
}

interface ClaimRow {
  attempts: number;
  id: string;
  kind: BackupWorkerJob['kind'];
  owner_id: string;
  preview_id: string | null;
  source_artifact_id: string | null;
  trigger_type: BackupWorkerJob['triggerType'];
}

function toJob(row: ClaimRow): BackupWorkerJob {
  return {
    attempts: row.attempts,
    id: row.id,
    kind: row.kind,
    ownerId: row.owner_id,
    previewId: row.preview_id,
    sourceArtifactId: row.source_artifact_id,
    triggerType: row.trigger_type,
  };
}

function safeErrorCode(error: unknown): string {
  const message =
    error instanceof Error ? error.message.split(':')[0] : 'BACKUP_JOB_FAILED';
  return (message ?? 'BACKUP_JOB_FAILED')
    .toLocaleUpperCase('en-US')
    .replace(/[^A-Z0-9_]+/g, '_')
    .slice(0, 80);
}

function safeErrorMessage(code: string, kind: BackupWorkerJob['kind']): string {
  const messages: Record<string, string> = {
    BACKUP_ARTIFACT_CHECKSUM_MISMATCH:
      'The stored backup did not match its recorded checksum.',
    BACKUP_ATTACHMENT_CHECKSUM_MISMATCH:
      'An attachment changed while the backup was being prepared.',
    BACKUP_CONTENT_CHECKSUM_MISMATCH:
      'A file inside the backup did not pass verification.',
    BACKUP_PASSWORD_INCORRECT:
      'The saved encryption password could not open this backup.',
    BACKUP_PASSWORD_UNAVAILABLE:
      'This encrypted backup needs its saved encryption password.',
    BACKUP_UPLOAD_CHECKSUM_MISMATCH: 'The backup upload could not be verified.',
    RESTORE_RECOVERY_FAILED:
      'Restore recovery needs manual attention. The safety backup was preserved.',
  };
  return (
    messages[code] ??
    (kind === 'restore'
      ? 'The restore stopped safely. The safety backup was preserved.'
      : kind === 'preview'
        ? 'The restore preview could not verify this backup.'
        : 'The backup failed before any previous valid backup was removed.')
  );
}

export class PostgresBackupWorkerStore implements BackupWorkerStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async heartbeat(now: Date): Promise<void> {
    await this.database
      .insertInto('worker_heartbeats')
      .values({
        last_seen_at: now,
        metadata: { queue: 'backup_jobs' },
        status: 'online',
        worker_name: 'backup-worker',
      })
      .onConflict((conflict) =>
        conflict.column('worker_name').doUpdateSet({
          last_seen_at: now,
          metadata: { queue: 'backup_jobs' },
          status: 'online',
          updated_at: now,
        }),
      )
      .execute();
  }

  async recoverStale(now: Date): Promise<number> {
    const result = await this.database
      .updateTable('backup_jobs')
      .set({
        error_code: 'WORKER_LOCK_EXPIRED',
        error_message:
          'The backup worker stopped before this job could finish.',
        finished_at: now,
        locked_at: null,
        progress_stage: 'Stopped safely',
        status: 'failed',
        updated_at: now,
      })
      .where('status', '=', 'processing')
      .where('locked_at', '<', new Date(now.getTime() - STALE_JOB_MILLISECONDS))
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async scheduleDue(now: Date): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      const lock = await sql<{ acquired: boolean }>`
        select pg_try_advisory_xact_lock(
          hashtextextended('bizziemoney-backup-scheduler', 0)
        ) as acquired
      `.execute(transaction);
      if (!lock.rows[0]?.acquired) return 0;

      const configs = await transaction
        .selectFrom('backup_configs')
        .innerJoin(
          'app_settings',
          'app_settings.owner_id',
          'backup_configs.owner_id',
        )
        .select([
          'backup_configs.backup_time',
          'backup_configs.day_of_month',
          'backup_configs.day_of_week',
          'backup_configs.frequency',
          'backup_configs.next_run_at',
          'backup_configs.owner_id',
          'app_settings.time_zone',
        ])
        .where('backup_configs.enabled', '=', true)
        .where('backup_configs.next_run_at', '<=', now)
        .where('backup_configs.next_run_at', 'is not', null)
        .orderBy('backup_configs.next_run_at')
        .forUpdate()
        .skipLocked()
        .execute();
      for (const config of configs) {
        if (!config.next_run_at) continue;
        const scheduleKey = `scheduled:${config.next_run_at.toISOString()}`;
        await transaction
          .insertInto('backup_jobs')
          .values({
            id: randomUUID(),
            idempotency_key: scheduleKey,
            kind: 'backup',
            owner_id: config.owner_id,
            scheduled_at: now,
            trigger_type: 'scheduled',
          })
          .onConflict((conflict) =>
            conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
          )
          .execute();
        await transaction
          .updateTable('backup_configs')
          .set({
            last_scheduled_at: config.next_run_at,
            next_run_at: nextBackupRun(
              {
                backupTime: config.backup_time.slice(0, 5),
                dayOfMonth: config.day_of_month,
                dayOfWeek: config.day_of_week,
                frequency: config.frequency,
              },
              config.next_run_at,
              config.time_zone,
            ),
            updated_at: now,
          })
          .where('owner_id', '=', config.owner_id)
          .execute();
      }
      return configs.length;
    });
  }

  async claim(now: Date): Promise<BackupWorkerJob | null> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await sql<ClaimRow>`
        with next_job as (
          select id
          from backup_jobs
          where status = 'queued'
            and scheduled_at <= ${now}
            and attempts < ${MAX_JOB_ATTEMPTS}
          order by scheduled_at asc, created_at asc, id asc
          for update skip locked
          limit 1
        )
        update backup_jobs as job
        set
          status = 'processing',
          attempts = job.attempts + 1,
          started_at = coalesce(job.started_at, ${now}),
          locked_at = ${now},
          progress_percent = 2,
          progress_stage = 'Starting',
          updated_at = ${now}
        from next_job
        where job.id = next_job.id
        returning
          job.id,
          job.owner_id,
          job.kind,
          job.trigger_type,
          job.source_artifact_id,
          job.preview_id,
          job.attempts
      `.execute(transaction);
      return result.rows[0] ? toJob(result.rows[0]) : null;
    });
  }

  async getConfig(ownerId: string): Promise<WorkerBackupConfig | null> {
    const row = await this.database
      .selectFrom('backup_configs')
      .innerJoin(
        'app_settings',
        'app_settings.owner_id',
        'backup_configs.owner_id',
      )
      .selectAll('backup_configs')
      .select('app_settings.time_zone')
      .where('backup_configs.owner_id', '=', ownerId)
      .executeTakeFirst();
    return row
      ? {
          backupTime: row.backup_time.slice(0, 5),
          dayOfMonth: row.day_of_month,
          dayOfWeek: row.day_of_week,
          destination: row.destination,
          encryptionPasswordCiphertext: row.encryption_password_ciphertext,
          frequency: row.frequency,
          includeAttachments: row.include_attachments,
          localSubfolder: row.local_subfolder,
          ownerId: row.owner_id,
          retentionCount: row.retention_count,
          s3Bucket: row.s3_bucket,
          s3CredentialsCiphertext: row.s3_credentials_ciphertext,
          s3Endpoint: row.s3_endpoint,
          s3ForcePathStyle: row.s3_force_path_style,
          s3Prefix: row.s3_prefix,
          s3Region: row.s3_region,
          timeZone: row.time_zone,
        }
      : null;
  }

  async getArtifact(
    ownerId: string,
    artifactId: string,
  ): Promise<WorkerArtifact | null> {
    const row = await this.database
      .selectFrom('backup_artifacts')
      .select([
        'checksum_sha256',
        'encrypted',
        'id',
        'object_key',
        'owner_id',
        'status',
        'storage_provider',
        'storage_root',
      ])
      .where('owner_id', '=', ownerId)
      .where('id', '=', artifactId)
      .executeTakeFirst();
    return row
      ? {
          checksumSha256: row.checksum_sha256,
          encrypted: row.encrypted,
          id: row.id,
          objectKey: row.object_key,
          ownerId: row.owner_id,
          status: row.status,
          storageProvider: row.storage_provider,
          storageRoot: row.storage_root,
        }
      : null;
  }

  async progress(
    jobId: string,
    percent: number,
    stage: string,
    now: Date,
  ): Promise<void> {
    await this.database
      .updateTable('backup_jobs')
      .set({
        locked_at: now,
        progress_percent: percent,
        progress_stage: stage,
        updated_at: now,
      })
      .where('id', '=', jobId)
      .where('status', '=', 'processing')
      .execute();
  }

  async completeBackup(
    job: BackupWorkerJob,
    artifact: CompletedArtifact,
    now: Date,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('backup_artifacts')
        .values({
          application_version: artifact.applicationVersion,
          attachment_count: artifact.attachmentCount,
          backup_created_at: artifact.backupCreatedAt,
          checksum_sha256: artifact.checksumSha256,
          encrypted: artifact.encrypted,
          file_name: artifact.fileName,
          id: artifact.id,
          includes_attachments: artifact.includesAttachments,
          job_id: job.id,
          manifest_summary: artifact.manifestSummary,
          object_key: artifact.objectKey,
          owner_id: job.ownerId,
          schema_version: artifact.schemaVersion,
          size_bytes: artifact.sizeBytes,
          status: 'verified',
          storage_provider: artifact.storageProvider,
          storage_root: artifact.storageRoot,
          verified_at: now,
        })
        .execute();
      await transaction
        .updateTable('backup_jobs')
        .set({
          error_code: null,
          error_message: null,
          finished_at: now,
          locked_at: null,
          progress_percent: 100,
          progress_stage: 'Verified',
          status: 'succeeded',
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
      await transaction
        .insertInto('audit_events')
        .values({
          event_type: 'backup.created',
          id: randomUUID(),
          metadata: {
            artifactId: artifact.id,
            encrypted: artifact.encrypted,
            includesAttachments: artifact.includesAttachments,
            trigger: job.triggerType,
          },
          owner_id: job.ownerId,
        })
        .execute();
    });
  }

  async completePreview(
    job: BackupWorkerJob,
    summary: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      if (!job.previewId) throw new Error('RESTORE_PREVIEW_ID_MISSING');
      await transaction
        .updateTable('restore_previews')
        .set({ status: 'ready', summary, updated_at: now })
        .where('id', '=', job.previewId)
        .where('owner_id', '=', job.ownerId)
        .execute();
      await transaction
        .updateTable('backup_jobs')
        .set({
          finished_at: now,
          locked_at: null,
          progress_percent: 100,
          progress_stage: 'Preview ready',
          status: 'succeeded',
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
    });
  }

  async createSafetyJob(
    parentJob: BackupWorkerJob,
    now: Date,
  ): Promise<BackupWorkerJob> {
    const row = await this.database
      .insertInto('backup_jobs')
      .values({
        attempts: 1,
        id: randomUUID(),
        idempotency_key: `safety:${parentJob.id}`,
        kind: 'backup',
        locked_at: now,
        owner_id: parentJob.ownerId,
        progress_percent: 2,
        progress_stage: 'Preparing restore safety backup',
        scheduled_at: now,
        started_at: now,
        status: 'processing',
        trigger_type: 'safety',
      })
      .onConflict((conflict) =>
        conflict.columns(['owner_id', 'idempotency_key']).doUpdateSet({
          locked_at: now,
          progress_stage: 'Preparing restore safety backup',
          status: 'processing',
          updated_at: now,
        }),
      )
      .returning([
        'attempts',
        'id',
        'kind',
        'owner_id',
        'preview_id',
        'source_artifact_id',
        'trigger_type',
      ])
      .executeTakeFirstOrThrow();
    return toJob(row);
  }

  async setSafetyArtifact(
    restoreJobId: string,
    artifactId: string,
    now: Date,
  ): Promise<void> {
    await this.database
      .updateTable('backup_jobs')
      .set({
        locked_at: now,
        progress_percent: 35,
        progress_stage: 'Safety backup verified',
        safety_artifact_id: artifactId,
        updated_at: now,
      })
      .where('id', '=', restoreJobId)
      .execute();
  }

  async completeRestore(job: BackupWorkerJob, now: Date): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('backup_jobs')
        .set({
          finished_at: now,
          locked_at: null,
          progress_percent: 100,
          progress_stage: 'Restore completed',
          status: 'succeeded',
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
      await transaction
        .insertInto('audit_events')
        .values({
          event_type: 'backup.restored',
          id: randomUUID(),
          metadata: {
            artifactId: job.sourceArtifactId,
            previewId: job.previewId,
          },
          owner_id: job.ownerId,
        })
        .execute();
    });
  }

  async fail(
    job: BackupWorkerJob,
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('backup_jobs')
        .set({
          error_code: errorCode,
          error_message: errorMessage,
          finished_at: now,
          locked_at: null,
          progress_stage: 'Failed safely',
          status: 'failed',
          updated_at: now,
        })
        .where('id', '=', job.id)
        .execute();
      if (job.kind === 'preview' && job.previewId) {
        await transaction
          .updateTable('restore_previews')
          .set({ status: 'failed', updated_at: now })
          .where('id', '=', job.previewId)
          .execute();
      }
      await transaction
        .insertInto('audit_events')
        .values({
          event_type:
            job.kind === 'restore' ? 'backup.restore_failed' : 'backup.failed',
          id: randomUUID(),
          metadata: { errorCode, jobId: job.id, kind: job.kind },
          owner_id: job.ownerId,
        })
        .execute();
    });
  }

  async listRetentionCandidates(
    ownerId: string,
    retentionCount: number,
  ): Promise<RetentionArtifact[]> {
    const result = await sql<{
      id: string;
      object_key: string;
      storage_provider: 'local' | 's3';
      storage_root: string;
    }>`
      select
        artifact.id,
        artifact.object_key,
        artifact.storage_provider,
        artifact.storage_root
      from backup_artifacts as artifact
      inner join backup_jobs as job on job.id = artifact.job_id
      where artifact.owner_id = ${ownerId}
        and artifact.status = 'verified'
        and job.trigger_type <> 'safety'
      order by artifact.backup_created_at desc, artifact.id desc
      offset ${retentionCount}
      limit 100
    `.execute(this.database);
    return result.rows.map((row) => ({
      id: row.id,
      objectKey: row.object_key,
      storageProvider: row.storage_provider,
      storageRoot: row.storage_root,
    }));
  }

  async markArtifactDeleted(artifactId: string, now: Date): Promise<void> {
    await this.database
      .updateTable('backup_artifacts')
      .set({
        deleted_at: now,
        status: 'deleted',
        updated_at: now,
      })
      .where('id', '=', artifactId)
      .where('status', '=', 'verified')
      .execute();
  }
}

function readCredentials(
  box: SecretBox,
  ciphertext: string | null,
): BackupCredentials | null {
  if (!ciphertext) return null;
  const value = JSON.parse(box.open(ciphertext)) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessKeyId' in value) ||
    !('secretAccessKey' in value) ||
    typeof value.accessKeyId !== 'string' ||
    typeof value.secretAccessKey !== 'string'
  ) {
    throw new Error('BACKUP_CREDENTIALS_INVALID');
  }
  return {
    accessKeyId: value.accessKeyId,
    secretAccessKey: value.secretAccessKey,
  };
}

export class BackupJobProcessor {
  constructor(
    private readonly store: BackupWorkerStore,
    private readonly archive: BackupArchive,
    private readonly storageBase: BackupStorageBaseConfig,
    private readonly secretBox: SecretBox,
    private readonly currentSchemaVersion: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recoverStale(): Promise<number> {
    return this.store.recoverStale(this.now());
  }

  async heartbeat(): Promise<void> {
    return this.store.heartbeat(this.now());
  }

  async runBatch(limit = 2): Promise<number> {
    await this.store.scheduleDue(this.now());
    let processed = 0;
    while (processed < limit) {
      const job = await this.store.claim(this.now());
      if (!job) break;
      try {
        if (job.kind === 'backup') {
          await this.processBackup(job, job.triggerType === 'safety');
        } else if (job.kind === 'preview') {
          await this.processPreview(job);
        } else {
          await this.processRestore(job);
        }
      } catch (error) {
        const code = safeErrorCode(error);
        await this.store.fail(
          job,
          code,
          safeErrorMessage(code, job.kind),
          this.now(),
        );
      }
      processed += 1;
    }
    return processed;
  }

  private async processBackup(
    job: BackupWorkerJob,
    forceAttachments: boolean,
  ): Promise<string> {
    const config = await this.requiredConfig(job.ownerId);
    const storage = this.storageForConfig(config);
    const encryptionPassword = config.encryptionPasswordCiphertext
      ? this.secretBox.open(config.encryptionPasswordCiphertext)
      : null;
    await this.store.progress(
      job.id,
      12,
      'Creating PostgreSQL backup',
      this.now(),
    );
    const prepared = await this.archive.prepareBackup({
      applicationVersion: APP_VERSION,
      encryptionPassword,
      includeAttachments: forceAttachments || config.includeAttachments,
      ownerId: job.ownerId,
      schemaVersion: this.currentSchemaVersion,
    });
    try {
      await this.store.progress(job.id, 70, 'Uploading backup', this.now());
      const artifactId = randomUUID();
      const timestamp = prepared.manifest.backupCreatedAt
        .replaceAll(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
      const extension = prepared.encrypted ? 'bzm.enc' : 'bzm';
      const objectKey = `${job.ownerId}/${timestamp.slice(0, 8)}/${artifactId}.${extension}`;
      const fileName = `BizzieMoney-${timestamp}.${extension}`;
      await storage.putFile({
        checksumSha256: prepared.checksumSha256,
        filePath: prepared.filePath,
        mimeType: 'application/octet-stream',
        objectKey,
      });
      await this.store.progress(
        job.id,
        88,
        'Verifying stored backup',
        this.now(),
      );
      await this.archive.verifyStoredObject(
        storage,
        objectKey,
        prepared.checksumSha256,
      );
      await this.store.completeBackup(
        job,
        this.completedArtifact(
          artifactId,
          objectKey,
          fileName,
          storage,
          prepared,
        ),
        this.now(),
      );
      if (!forceAttachments) {
        await this.enforceRetention(config, storage);
      }
      return artifactId;
    } finally {
      await prepared.cleanup();
    }
  }

  private async processPreview(job: BackupWorkerJob): Promise<void> {
    const config = await this.requiredConfig(job.ownerId);
    const artifact = await this.requiredArtifact(job);
    await this.store.progress(
      job.id,
      25,
      'Downloading verified backup',
      this.now(),
    );
    const extracted = await this.archive.extractArtifact({
      checksumSha256: artifact.checksumSha256,
      encrypted: artifact.encrypted,
      encryptionPassword: config.encryptionPasswordCiphertext
        ? this.secretBox.open(config.encryptionPasswordCiphertext)
        : null,
      objectKey: artifact.objectKey,
      storage: this.storageForArtifact(config, artifact),
    });
    try {
      const warnings: string[] = [];
      if (extracted.manifest.schemaVersion > this.currentSchemaVersion) {
        warnings.push(
          'This backup was created by a newer database schema and cannot be restored here.',
        );
      }
      if (!extracted.manifest.includesAttachments) {
        warnings.push(
          'This backup contains attachment metadata only; file bytes are not included.',
        );
      }
      await this.store.completePreview(
        job,
        {
          applicationVersion: extracted.manifest.applicationVersion,
          attachmentCount: extracted.manifest.attachmentCount,
          backupCreatedAt: extracted.manifest.backupCreatedAt,
          encrypted: artifact.encrypted,
          includesAttachments: extracted.manifest.includesAttachments,
          schemaVersion: extracted.manifest.schemaVersion,
          tables: extracted.manifest.tables,
          warnings,
        },
        this.now(),
      );
    } finally {
      await extracted.cleanup();
    }
  }

  private async processRestore(job: BackupWorkerJob): Promise<void> {
    const config = await this.requiredConfig(job.ownerId);
    const targetArtifact = await this.requiredArtifact(job);
    await this.store.progress(job.id, 8, 'Creating safety backup', this.now());
    const safetyJob = await this.store.createSafetyJob(job, this.now());
    const safetyArtifactId = await this.processBackup(safetyJob, true);
    await this.store.setSafetyArtifact(job.id, safetyArtifactId, this.now());

    const target = await this.archive.extractArtifact({
      checksumSha256: targetArtifact.checksumSha256,
      encrypted: targetArtifact.encrypted,
      encryptionPassword: config.encryptionPasswordCiphertext
        ? this.secretBox.open(config.encryptionPasswordCiphertext)
        : null,
      objectKey: targetArtifact.objectKey,
      storage: this.storageForArtifact(config, targetArtifact),
    });
    try {
      if (target.manifest.schemaVersion > this.currentSchemaVersion) {
        throw new Error('RESTORE_SCHEMA_TOO_NEW');
      }
      await this.store.progress(
        job.id,
        55,
        'Restoring PostgreSQL data',
        this.now(),
      );
      try {
        await this.archive.restoreDatabase(target.payloadDirectory);
        await this.store.progress(
          job.id,
          82,
          'Restoring attachment files',
          this.now(),
        );
        if (target.manifest.includesAttachments) {
          await this.archive.restoreAttachments(
            target.payloadDirectory,
            target.manifest,
          );
        }
      } catch {
        await this.recoverFromSafety(job, config, safetyArtifactId);
        throw new Error('RESTORE_APPLY_FAILED');
      }
      await this.store.completeRestore(job, this.now());
    } finally {
      await target.cleanup();
    }
  }

  private async recoverFromSafety(
    job: BackupWorkerJob,
    config: WorkerBackupConfig,
    safetyArtifactId: string,
  ): Promise<void> {
    const artifact = await this.store.getArtifact(
      job.ownerId,
      safetyArtifactId,
    );
    if (!artifact) throw new Error('RESTORE_RECOVERY_FAILED');
    const extracted = await this.archive.extractArtifact({
      checksumSha256: artifact.checksumSha256,
      encrypted: artifact.encrypted,
      encryptionPassword: config.encryptionPasswordCiphertext
        ? this.secretBox.open(config.encryptionPasswordCiphertext)
        : null,
      objectKey: artifact.objectKey,
      storage: this.storageForArtifact(config, artifact),
    });
    try {
      await this.archive.restoreDatabase(extracted.payloadDirectory);
      await this.archive.restoreAttachments(
        extracted.payloadDirectory,
        extracted.manifest,
      );
    } catch {
      throw new Error('RESTORE_RECOVERY_FAILED');
    } finally {
      await extracted.cleanup();
    }
  }

  private completedArtifact(
    id: string,
    objectKey: string,
    fileName: string,
    storage: AttachmentStorage,
    prepared: PreparedBackup,
  ): CompletedArtifact {
    return {
      applicationVersion: prepared.manifest.applicationVersion,
      attachmentCount: prepared.manifest.attachmentCount,
      backupCreatedAt: new Date(prepared.manifest.backupCreatedAt),
      checksumSha256: prepared.checksumSha256,
      encrypted: prepared.encrypted,
      fileName,
      id,
      includesAttachments: prepared.manifest.includesAttachments,
      manifestSummary: {
        attachmentCount: prepared.manifest.attachmentCount,
        formatVersion: prepared.manifest.formatVersion,
        tables: prepared.manifest.tables,
      },
      objectKey,
      schemaVersion: prepared.manifest.schemaVersion,
      sizeBytes: prepared.sizeBytes,
      storageProvider: storage.provider,
      storageRoot: storage.rootIdentifier,
    };
  }

  private async requiredConfig(ownerId: string): Promise<WorkerBackupConfig> {
    const config = await this.store.getConfig(ownerId);
    if (!config) throw new Error('BACKUP_NOT_CONFIGURED');
    return config;
  }

  private async requiredArtifact(
    job: BackupWorkerJob,
  ): Promise<WorkerArtifact> {
    if (!job.sourceArtifactId) throw new Error('BACKUP_ARTIFACT_ID_MISSING');
    const artifact = await this.store.getArtifact(
      job.ownerId,
      job.sourceArtifactId,
    );
    if (!artifact || artifact.status !== 'verified') {
      throw new Error('BACKUP_ARTIFACT_UNAVAILABLE');
    }
    return artifact;
  }

  private storageForConfig(config: WorkerBackupConfig): AttachmentStorage {
    if (config.destination === 'local') {
      return createBackupStorage(this.storageBase, {
        localSubfolder: config.localSubfolder,
        provider: 'local',
      });
    }
    if (!config.s3Bucket || !config.s3Region || !config.s3Prefix) {
      throw new Error('BACKUP_S3_CONFIGURATION_INCOMPLETE');
    }
    const credentials = readCredentials(
      this.secretBox,
      config.s3CredentialsCiphertext,
    );
    const s3: S3StorageConfig = {
      accessKeyId: credentials?.accessKeyId,
      bucket: config.s3Bucket,
      endpoint: config.s3Endpoint ?? undefined,
      forcePathStyle: config.s3ForcePathStyle,
      prefix: config.s3Prefix,
      region: config.s3Region,
      secretAccessKey: credentials?.secretAccessKey,
    };
    return createBackupStorage(this.storageBase, { provider: 's3', s3 });
  }

  private storageForArtifact(
    config: WorkerBackupConfig,
    artifact: Pick<
      WorkerArtifact | RetentionArtifact,
      'storageProvider' | 'storageRoot'
    >,
  ): AttachmentStorage {
    const storage = this.storageForConfig(config);
    if (
      storage.provider !== artifact.storageProvider ||
      storage.rootIdentifier !== artifact.storageRoot
    ) {
      throw new Error('BACKUP_STORAGE_CONFIGURATION_MISMATCH');
    }
    return storage;
  }

  private async enforceRetention(
    config: WorkerBackupConfig,
    currentStorage: AttachmentStorage,
  ): Promise<void> {
    const candidates = await this.store.listRetentionCandidates(
      config.ownerId,
      config.retentionCount,
    );
    for (const artifact of candidates) {
      const storage =
        currentStorage.provider === artifact.storageProvider &&
        currentStorage.rootIdentifier === artifact.storageRoot
          ? currentStorage
          : this.storageForArtifact(config, artifact);
      await storage.deleteObject(artifact.objectKey);
      await this.store.markArtifactDeleted(artifact.id, this.now());
    }
  }
}

export type { BackupManifest };
