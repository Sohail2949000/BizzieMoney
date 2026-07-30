import type { BackupFrequency } from '@bizziemoney/shared';

export type BackupDestination = 'local' | 's3';
export type BackupJobKind = 'backup' | 'preview' | 'restore';
export type BackupJobStatus = 'failed' | 'processing' | 'queued' | 'succeeded';

export interface BackupS3Input {
  accessKeyId?: string | undefined;
  bucket: string;
  endpoint: string | null;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretAccessKey?: string | undefined;
}

export interface BackupConfigInput {
  backupTime: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  destination: BackupDestination;
  enabled: boolean;
  encryptionPassword?: string | null | undefined;
  frequency: BackupFrequency;
  includeAttachments: boolean;
  localSubfolder: string;
  retentionCount: number;
  s3: BackupS3Input | null;
}

export interface PublicBackupConfig {
  backupTime: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  destination: BackupDestination;
  enabled: boolean;
  frequency: BackupFrequency;
  hasEncryptionPassword: boolean;
  includeAttachments: boolean;
  localSubfolder: string;
  nextRunAt: string | null;
  retentionCount: number;
  s3: {
    bucket: string;
    endpoint: string | null;
    forcePathStyle: boolean;
    hasCredentials: boolean;
    prefix: string;
    region: string;
  } | null;
  updatedAt: string;
}

export interface BackupJobSummary {
  createdAt: string;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  kind: BackupJobKind;
  progressPercent: number;
  progressStage: string;
  startedAt: string | null;
  status: BackupJobStatus;
  triggerType: 'manual' | 'safety' | 'scheduled';
}

export interface BackupArtifactSummary {
  applicationVersion: string;
  attachmentCount: number;
  backupCreatedAt: string;
  checksumSha256: string;
  encrypted: boolean;
  fileName: string;
  id: string;
  includesAttachments: boolean;
  schemaVersion: number;
  sizeBytes: string;
  storageProvider: BackupDestination;
}

export interface BackupStatus {
  activeJob: BackupJobSummary | null;
  configured: boolean;
  config: PublicBackupConfig | null;
  lastSuccessfulBackup: BackupArtifactSummary | null;
  worker: {
    lastSeenAt: string | null;
    status: 'offline' | 'online' | 'unknown';
  };
}

export interface BackupHistory {
  artifacts: BackupArtifactSummary[];
  jobs: BackupJobSummary[];
}

export interface RestorePreviewSummary {
  applicationVersion: string;
  attachmentCount: number;
  backupCreatedAt: string;
  encrypted: boolean;
  includesAttachments: boolean;
  schemaVersion: number;
  tables: Record<string, number>;
  warnings: string[];
}

export interface RestorePreview {
  artifactId: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  job: BackupJobSummary;
  status: 'failed' | 'pending' | 'ready';
  summary: RestorePreviewSummary | null;
  usedAt: string | null;
}

export interface BackupServiceContract {
  createRestorePreview(
    ownerId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<RestorePreview>;
  enqueueBackup(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<BackupJobSummary>;
  enqueueRestore(
    ownerId: string,
    previewId: string,
    idempotencyKey: string,
  ): Promise<BackupJobSummary>;
  getConfig(ownerId: string): Promise<PublicBackupConfig | null>;
  getPreview(ownerId: string, previewId: string): Promise<RestorePreview>;
  getStatus(ownerId: string): Promise<BackupStatus>;
  listHistory(ownerId: string): Promise<BackupHistory>;
  saveConfig(
    ownerId: string,
    input: BackupConfigInput,
  ): Promise<PublicBackupConfig>;
  testDestination(
    ownerId: string,
    input: BackupConfigInput,
  ): Promise<{ message: string }>;
}
