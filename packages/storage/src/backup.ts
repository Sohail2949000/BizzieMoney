import { resolve } from 'node:path';

import { z } from 'zod';

import type { S3StorageConfig } from './config';
import { LocalAttachmentStorage } from './local';
import { S3AttachmentStorage } from './s3';
import type { AttachmentStorage } from './types';

const backupEnvironmentSchema = z.object({
  BACKUP_LOCAL_PATH: z.string().trim().min(1).default('/data/backups'),
});

const SAFE_SUBFOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export interface BackupStorageBaseConfig {
  localPath: string;
}

export type BackupStorageSelection =
  | {
      localSubfolder: string;
      provider: 'local';
    }
  | {
      provider: 's3';
      s3: S3StorageConfig;
    };

export function readBackupStorageBaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BackupStorageBaseConfig {
  const parsed = backupEnvironmentSchema.parse(environment);
  return { localPath: parsed.BACKUP_LOCAL_PATH };
}

export function createBackupStorage(
  base: BackupStorageBaseConfig,
  selection: BackupStorageSelection,
): AttachmentStorage {
  if (selection.provider === 's3') {
    return new S3AttachmentStorage(selection.s3);
  }
  if (!SAFE_SUBFOLDER.test(selection.localSubfolder)) {
    throw new Error('BACKUP_LOCAL_SUBFOLDER_INVALID');
  }
  return new LocalAttachmentStorage(
    resolve(base.localPath, selection.localSubfolder),
  );
}
