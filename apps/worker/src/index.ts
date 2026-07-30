import {
  createDatabase,
  verifyDatabaseConnection,
} from '@bizziemoney/database';
import { APP_SCHEMA_VERSION } from '@bizziemoney/shared';
import {
  attachmentStorageConfigFromPersisted,
  createConfigurableStorageRegistry,
  readAttachmentStorageConfig,
  readBackupStorageBaseConfig,
  SecretBox,
  type PersistedAttachmentStorageConfig,
} from '@bizziemoney/storage';

import {
  AttachmentCleanupProcessor,
  PostgresAttachmentCleanupStore,
} from './attachments';
import { BackupArchiveService } from './backup-archive';
import { BackupJobProcessor, PostgresBackupWorkerStore } from './backups';
import { readWorkerConfig } from './config';
import {
  DebtMaintenanceProcessor,
  PostgresDebtMaintenanceStore,
} from './debts';
import {
  PostgresSubscriptionMaintenanceStore,
  SubscriptionMaintenanceProcessor,
} from './subscriptions';
import {
  PostgresSessionMaintenanceStore,
  SessionMaintenanceProcessor,
} from './sessions';

async function main(): Promise<void> {
  const config = readWorkerConfig();
  const database = createDatabase({
    applicationName: 'bizziemoney-worker',
    connectionString: config.DATABASE_URL,
    maxConnections: 2,
  });
  const attachmentStorageBase = readAttachmentStorageConfig();
  const storageSecretBox = new SecretBox(
    config.BACKUP_SECRETS_KEY ?? config.SESSION_SECRET,
  );
  const storage = createConfigurableStorageRegistry(
    attachmentStorageBase,
    async (ownerId, location) => {
      let persisted: PersistedAttachmentStorageConfig | null;
      if (location?.provider === 's3') {
        const profile = await database
          .selectFrom('attachment_storage_s3_profiles')
          .selectAll()
          .where('owner_id', '=', ownerId)
          .where('storage_root', '=', location.rootIdentifier)
          .executeTakeFirst();
        persisted = profile
          ? {
              activeProvider: 's3',
              s3Bucket: profile.bucket,
              s3CredentialsCiphertext: profile.credentials_ciphertext,
              s3Endpoint: profile.endpoint,
              s3ForcePathStyle: profile.force_path_style,
              s3Prefix: profile.prefix,
              s3Region: profile.region,
            }
          : null;
      } else {
        const saved = await database
          .selectFrom('attachment_storage_configs')
          .selectAll()
          .where('owner_id', '=', ownerId)
          .executeTakeFirst();
        persisted = saved
          ? {
              activeProvider: saved.active_provider,
              s3Bucket: saved.s3_bucket,
              s3CredentialsCiphertext: saved.s3_credentials_ciphertext,
              s3Endpoint: saved.s3_endpoint,
              s3ForcePathStyle: saved.s3_force_path_style,
              s3Prefix: saved.s3_prefix,
              s3Region: saved.s3_region,
            }
          : null;
      }
      return attachmentStorageConfigFromPersisted(
        attachmentStorageBase,
        persisted,
        storageSecretBox,
      );
    },
  );
  const cleanupProcessor = new AttachmentCleanupProcessor(
    new PostgresAttachmentCleanupStore(database),
    storage,
  );
  const subscriptionProcessor = new SubscriptionMaintenanceProcessor(
    new PostgresSubscriptionMaintenanceStore(database),
  );
  const debtProcessor = new DebtMaintenanceProcessor(
    new PostgresDebtMaintenanceStore(database),
  );
  const sessionMaintenanceProcessor = new SessionMaintenanceProcessor(
    new PostgresSessionMaintenanceStore(database),
    config.SESSION_RETENTION_DAYS,
  );
  const backupProcessor = new BackupJobProcessor(
    new PostgresBackupWorkerStore(database),
    new BackupArchiveService(database, config.DATABASE_URL, storage),
    readBackupStorageBaseConfig(),
    new SecretBox(config.BACKUP_SECRETS_KEY ?? config.SESSION_SECRET),
    APP_SCHEMA_VERSION,
  );

  await verifyDatabaseConnection(database);
  const [recoveredJobs, recoveredBackupJobs] = await Promise.all([
    cleanupProcessor.recoverStale(),
    backupProcessor.recoverStale(),
    backupProcessor.heartbeat(),
  ]);
  console.info('BizzieMoney worker connected to PostgreSQL.');
  if (recoveredJobs > 0) {
    console.info(`Recovered ${recoveredJobs} stale attachment cleanup job(s).`);
  }
  if (recoveredBackupJobs > 0) {
    console.info(
      `Marked ${recoveredBackupJobs} interrupted backup job(s) failed.`,
    );
  }

  const heartbeat = setInterval(() => {
    void Promise.all([
      verifyDatabaseConnection(database),
      backupProcessor.heartbeat(),
    ]).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      console.error(`Worker database heartbeat failed: ${message}`);
    });
  }, config.WORKER_HEARTBEAT_INTERVAL_MS);
  let cleanupRunning = false;
  const cleanup = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupProcessor
      .runBatch()
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown cleanup error';
        console.error(`Attachment cleanup failed: ${message}`);
      })
      .finally(() => {
        cleanupRunning = false;
      });
  }, config.ATTACHMENT_CLEANUP_INTERVAL_MS);
  void cleanupProcessor.runBatch();
  let backupRunning = false;
  const backups = setInterval(() => {
    if (backupRunning) return;
    backupRunning = true;
    void backupProcessor
      .runBatch()
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown backup error';
        console.error(`Backup processing failed: ${message}`);
      })
      .finally(() => {
        backupRunning = false;
      });
  }, config.BACKUP_JOB_INTERVAL_MS);
  void backupProcessor.runBatch();
  let subscriptionMaintenanceRunning = false;
  const subscriptionMaintenance = setInterval(() => {
    if (subscriptionMaintenanceRunning) return;
    subscriptionMaintenanceRunning = true;
    void Promise.all([subscriptionProcessor.run(), debtProcessor.run()])
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown maintenance error';
        console.error(`Subscription maintenance failed: ${message}`);
      })
      .finally(() => {
        subscriptionMaintenanceRunning = false;
      });
  }, config.SUBSCRIPTION_REMINDER_INTERVAL_MS);
  void Promise.all([subscriptionProcessor.run(), debtProcessor.run()]);
  let sessionMaintenanceRunning = false;
  const sessionMaintenance = setInterval(() => {
    if (sessionMaintenanceRunning) return;
    sessionMaintenanceRunning = true;
    void sessionMaintenanceProcessor
      .run()
      .then(({ rateLimitsPruned, sessionsPruned }) => {
        if (sessionsPruned > 0 || rateLimitsPruned > 0) {
          console.info(
            `Pruned ${sessionsPruned} expired session(s) and ${rateLimitsPruned} stale login rate-limit record(s).`,
          );
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown session maintenance error';
        console.error(`Session maintenance failed: ${message}`);
      })
      .finally(() => {
        sessionMaintenanceRunning = false;
      });
  }, config.SESSION_MAINTENANCE_INTERVAL_MS);
  void sessionMaintenanceProcessor.run();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.info(`BizzieMoney worker received ${signal}; shutting down.`);
    clearInterval(heartbeat);
    clearInterval(cleanup);
    clearInterval(backups);
    clearInterval(subscriptionMaintenance);
    clearInterval(sessionMaintenance);
    await database.destroy();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`Worker startup failed: ${message}`);
  process.exitCode = 1;
});
