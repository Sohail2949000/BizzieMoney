import type { AttachmentStorageConfig, S3StorageConfig } from './config';
import type { SecretBox } from './secrets';

export interface PersistedAttachmentStorageConfig {
  activeProvider: 'local' | 's3';
  s3Bucket: string | null;
  s3CredentialsCiphertext: string | null;
  s3Endpoint: string | null;
  s3ForcePathStyle: boolean;
  s3Prefix: string | null;
  s3Region: string | null;
}

export interface AttachmentStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function parseCredentials(
  secretBox: SecretBox,
  ciphertext: string | null,
): AttachmentStorageCredentials | null {
  if (!ciphertext) return null;
  try {
    const value = JSON.parse(secretBox.open(ciphertext)) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('accessKeyId' in value) ||
      !('secretAccessKey' in value) ||
      typeof value.accessKeyId !== 'string' ||
      typeof value.secretAccessKey !== 'string'
    ) {
      throw new Error('invalid');
    }
    return {
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
    };
  } catch {
    throw new Error('ATTACHMENT_STORAGE_CREDENTIALS_INVALID');
  }
}

export function attachmentStorageConfigFromPersisted(
  baseConfig: AttachmentStorageConfig,
  persisted: PersistedAttachmentStorageConfig | null,
  secretBox: SecretBox,
): AttachmentStorageConfig | null {
  if (!persisted) return null;
  const credentials = parseCredentials(
    secretBox,
    persisted.s3CredentialsCiphertext,
  );
  const s3: S3StorageConfig | null =
    persisted.s3Bucket && persisted.s3Region && persisted.s3Prefix
      ? {
          accessKeyId: credentials?.accessKeyId,
          bucket: persisted.s3Bucket,
          endpoint: persisted.s3Endpoint ?? undefined,
          forcePathStyle: persisted.s3ForcePathStyle,
          prefix: persisted.s3Prefix,
          region: persisted.s3Region,
          secretAccessKey: credentials?.secretAccessKey,
        }
      : null;
  return {
    activeProvider: persisted.activeProvider,
    localPath: baseConfig.localPath,
    s3,
  };
}

export function sealAttachmentStorageCredentials(
  secretBox: SecretBox,
  credentials: AttachmentStorageCredentials,
): string {
  return secretBox.seal(JSON.stringify(credentials));
}
