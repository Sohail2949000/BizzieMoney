import { z } from 'zod';

export function normalizeAllowedOrigin(value: string): string {
  const candidate = value.trim();
  if (!candidate || candidate.includes('*')) {
    throw new Error('Origins must be exact and cannot contain wildcards.');
  }

  let origin: URL;
  try {
    origin = new URL(candidate);
  } catch {
    throw new Error(`Invalid origin: ${candidate}`);
  }

  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (origin.pathname !== '' && origin.pathname !== '/') ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      `Origins must use HTTP or HTTPS and cannot include credentials, paths, queries, or fragments: ${candidate}`,
    );
  }

  return origin.origin;
}

const originSchema = z.string().transform((value, context) => {
  try {
    return normalizeAllowedOrigin(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message:
        error instanceof Error ? error.message : 'Configure a valid origin.',
    });
    return z.NEVER;
  }
});

const apiEnvironmentSchema = z.object({
  ATTACHMENT_MALWARE_SCANNER: z
    .enum(['disabled', 'clamav'])
    .default('disabled'),
  ATTACHMENT_ALLOWED_MIME_TYPES: z
    .string()
    .default(
      'application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv',
    )
    .transform((value, context) => {
      const mimeTypes = [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim().toLocaleLowerCase('en-US'))
            .filter(Boolean),
        ),
      ];
      if (mimeTypes.length === 0 || mimeTypes.length > 12) {
        context.addIssue({
          code: 'custom',
          message: 'Configure between 1 and 12 attachment MIME types.',
        });
        return z.NEVER;
      }
      return mimeTypes;
    }),
  APP_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value, context) => {
      const configuredOrigins = value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      if (configuredOrigins.length > 12) {
        context.addIssue({
          code: 'custom',
          message: 'Configure no more than 12 allowed application origins.',
        });
        return z.NEVER;
      }

      try {
        return [
          ...new Set(
            configuredOrigins.map((origin) => normalizeAllowedOrigin(origin)),
          ),
        ];
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message:
            error instanceof Error
              ? error.message
              : 'Configure valid application origins.',
        });
        return z.NEVER;
      }
    }),
  APP_URL: originSchema,
  BACKUP_SECRETS_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).max(4_096).optional(),
  ),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CLAMAV_HOST: z.string().trim().min(1).max(253).default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(100).default(20),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  SESSION_SECRET: z.string().min(32).max(4_096),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(168),
});

export type ApiConfig = z.infer<typeof apiEnvironmentSchema>;

export function readApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const config = apiEnvironmentSchema.parse(environment);
  return {
    ...config,
    APP_ALLOWED_ORIGINS: [
      ...new Set([config.APP_URL, ...config.APP_ALLOWED_ORIGINS]),
    ],
  };
}
