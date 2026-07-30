import { z } from 'zod';

const workerEnvironmentSchema = z.object({
  ATTACHMENT_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(5_000),
  BACKUP_JOB_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  BACKUP_SECRETS_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).max(4_096).optional(),
  ),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32).max(4_096),
  SESSION_MAINTENANCE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(6 * 60 * 60_000),
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SUBSCRIPTION_REMINDER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(60_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .default(30_000),
});

export type WorkerConfig = z.infer<typeof workerEnvironmentSchema>;

export function readWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return workerEnvironmentSchema.parse(environment);
}
