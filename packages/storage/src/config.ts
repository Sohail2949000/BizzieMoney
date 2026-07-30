import { z } from 'zod';

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const storageEnvironmentSchema = z.object({
  ATTACHMENT_LOCAL_PATH: z.string().trim().min(1).default('/data/attachments'),
  ATTACHMENT_S3_ACCESS_KEY_ID: optionalText,
  ATTACHMENT_S3_BUCKET: optionalText,
  ATTACHMENT_S3_ENDPOINT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  ATTACHMENT_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ATTACHMENT_S3_PREFIX: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9/_-]*$/)
    .default('bizziemoney'),
  ATTACHMENT_S3_REGION: z.string().trim().min(1).default('auto'),
  ATTACHMENT_S3_SECRET_ACCESS_KEY: optionalText,
  ATTACHMENT_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
});

export interface S3StorageConfig {
  accessKeyId: string | undefined;
  bucket: string;
  endpoint: string | undefined;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretAccessKey: string | undefined;
}

export interface AttachmentStorageConfig {
  activeProvider: 'local' | 's3';
  localPath: string;
  s3: S3StorageConfig | null;
}

export function readAttachmentStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AttachmentStorageConfig {
  const parsed = storageEnvironmentSchema.parse(environment);
  const hasAccessKey = Boolean(parsed.ATTACHMENT_S3_ACCESS_KEY_ID);
  const hasSecretKey = Boolean(parsed.ATTACHMENT_S3_SECRET_ACCESS_KEY);
  if (hasAccessKey !== hasSecretKey) {
    throw new Error(
      'ATTACHMENT_S3_ACCESS_KEY_ID and ATTACHMENT_S3_SECRET_ACCESS_KEY must be configured together.',
    );
  }
  if (
    parsed.ATTACHMENT_STORAGE_PROVIDER === 's3' &&
    !parsed.ATTACHMENT_S3_BUCKET
  ) {
    throw new Error(
      'ATTACHMENT_S3_BUCKET is required when attachment storage uses S3.',
    );
  }

  return {
    activeProvider: parsed.ATTACHMENT_STORAGE_PROVIDER,
    localPath: parsed.ATTACHMENT_LOCAL_PATH,
    s3: parsed.ATTACHMENT_S3_BUCKET
      ? {
          accessKeyId: parsed.ATTACHMENT_S3_ACCESS_KEY_ID,
          bucket: parsed.ATTACHMENT_S3_BUCKET,
          endpoint: parsed.ATTACHMENT_S3_ENDPOINT,
          forcePathStyle: parsed.ATTACHMENT_S3_FORCE_PATH_STYLE,
          prefix: parsed.ATTACHMENT_S3_PREFIX.replace(/^\/+|\/+$/g, ''),
          region: parsed.ATTACHMENT_S3_REGION,
          secretAccessKey: parsed.ATTACHMENT_S3_SECRET_ACCESS_KEY,
        }
      : null,
  };
}
