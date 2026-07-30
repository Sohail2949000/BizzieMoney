import { apiRequest } from './client';

export type BackupFrequency = 'daily' | 'monthly' | 'weekly';
export type BackupDestination = 'local' | 's3';

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

export interface BackupConfig {
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

export interface BackupJob {
  createdAt: string;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  kind: 'backup' | 'preview' | 'restore';
  progressPercent: number;
  progressStage: string;
  startedAt: string | null;
  status: 'failed' | 'processing' | 'queued' | 'succeeded';
  triggerType: 'manual' | 'safety' | 'scheduled';
}

export interface BackupArtifact {
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
  activeJob: BackupJob | null;
  configured: boolean;
  config: BackupConfig | null;
  lastSuccessfulBackup: BackupArtifact | null;
  worker: {
    lastSeenAt: string | null;
    status: 'offline' | 'online' | 'unknown';
  };
}

export interface RestorePreview {
  artifactId: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  job: BackupJob;
  status: 'failed' | 'pending' | 'ready';
  summary: {
    applicationVersion: string;
    attachmentCount: number;
    backupCreatedAt: string;
    encrypted: boolean;
    includesAttachments: boolean;
    schemaVersion: number;
    tables: Record<string, number>;
    warnings: string[];
  } | null;
  usedAt: string | null;
}

function idempotencyHeaders(): Record<string, string> {
  return { 'idempotency-key': crypto.randomUUID() };
}

export const backupApi = {
  createPreview: (artifactId: string) =>
    apiRequest<RestorePreview>(
      `/api/backups/artifacts/${encodeURIComponent(artifactId)}/preview`,
      { headers: idempotencyHeaders(), method: 'POST' },
    ),
  getConfig: () =>
    apiRequest<{ config: BackupConfig | null }>('/api/backups/config'),
  getHistory: () =>
    apiRequest<{ artifacts: BackupArtifact[]; jobs: BackupJob[] }>(
      '/api/backups/history',
    ),
  getPreview: (previewId: string) =>
    apiRequest<RestorePreview>(
      `/api/backups/previews/${encodeURIComponent(previewId)}`,
    ),
  getStatus: () => apiRequest<BackupStatus>('/api/backups/status'),
  restore: (input: { currentPassword: string; previewId: string }) =>
    apiRequest<BackupJob>('/api/backups/restore', {
      body: input,
      headers: idempotencyHeaders(),
      method: 'POST',
    }),
  runNow: () =>
    apiRequest<BackupJob>('/api/backups/run', {
      headers: idempotencyHeaders(),
      method: 'POST',
    }),
  saveConfig: (input: BackupConfigInput) =>
    apiRequest<{ config: BackupConfig }>('/api/backups/config', {
      body: input,
      method: 'PATCH',
    }),
  testDestination: (input: BackupConfigInput) =>
    apiRequest<{ message: string }>('/api/backups/test-destination', {
      body: input,
      method: 'POST',
    }),
};
