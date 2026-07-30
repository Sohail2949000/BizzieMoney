import {
  createDatabase,
  verifyDatabaseConnection,
} from '@bizziemoney/database';
import {
  attachmentStorageConfigFromPersisted,
  readBackupStorageBaseConfig,
  SecretBox,
  createConfigurableStorageRegistry,
  readAttachmentStorageConfig,
  type PersistedAttachmentStorageConfig,
} from '@bizziemoney/storage';

import { readApiConfig } from './config';
import { AttachmentService } from './attachments/service';
import { createMalwareScanner } from './attachments/scanner';
import { PostgresAttachmentStore } from './attachments/store';
import { AuthService } from './auth/service';
import { PostgresAuthStore } from './auth/store';
import { BackupService } from './backups/service';
import { PostgresBackupStore } from './backups/store';
import { DebtService } from './debts/service';
import { PostgresDebtStore } from './debts/store';
import { DataService } from './data/service';
import { PostgresDataStore } from './data/store';
import { ExpenseService } from './expenses/service';
import { PostgresExpenseStore } from './expenses/store';
import { PreferenceService } from './preferences/service';
import { PostgresPreferenceStore } from './preferences/store';
import { SubscriptionService } from './subscriptions/service';
import { requestUsesSecureCookies } from './request-security';
import { PostgresSubscriptionStore } from './subscriptions/store';
import { buildServer } from './server';

async function main(): Promise<void> {
  const config = readApiConfig();
  const attachmentStorageBase = readAttachmentStorageConfig();
  const storageSecretBox = new SecretBox(
    config.BACKUP_SECRETS_KEY ?? config.SESSION_SECRET,
  );
  const database = createDatabase({
    applicationName: 'bizziemoney-api',
    connectionString: config.DATABASE_URL,
  });
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
  const authStore = new PostgresAuthStore(database);
  const authService = new AuthService(
    authStore,
    config.SESSION_SECRET,
    config.SESSION_TTL_HOURS,
  );
  const backupService = new BackupService(
    new PostgresBackupStore(database),
    readBackupStorageBaseConfig(),
    new SecretBox(config.BACKUP_SECRETS_KEY ?? config.SESSION_SECRET),
  );
  const expenseService = ExpenseService.fromPostgres(
    new PostgresExpenseStore(database),
  );
  const preferenceService = new PreferenceService(
    new PostgresPreferenceStore(database),
  );
  const debtService = DebtService.fromPostgres(new PostgresDebtStore(database));
  const dataService = new DataService(new PostgresDataStore(database), storage);
  const attachmentService = AttachmentService.fromPostgres(
    new PostgresAttachmentStore(database),
    storage,
    config.MAX_UPLOAD_SIZE_MB * 1_048_576,
    new Set(config.ATTACHMENT_ALLOWED_MIME_TYPES),
    {
      baseConfig: attachmentStorageBase,
      secretBox: storageSecretBox,
    },
    createMalwareScanner({
      host: config.CLAMAV_HOST,
      mode: config.ATTACHMENT_MALWARE_SCANNER,
      port: config.CLAMAV_PORT,
      timeoutMs: config.CLAMAV_TIMEOUT_MS,
    }),
  );
  const subscriptionService = SubscriptionService.fromPostgres(
    new PostgresSubscriptionStore(database),
  );
  const appOrigin = new URL(config.APP_URL).origin;
  const server = buildServer({
    appOrigin,
    appOrigins: config.APP_ALLOWED_ORIGINS,
    attachmentService,
    authService,
    backupService,
    contentSecurityPolicy: config.NODE_ENV === 'production',
    cookieSecure: (request) =>
      requestUsesSecureCookies(
        request,
        config.APP_ALLOWED_ORIGINS,
        config.NODE_ENV === 'production' &&
          new URL(config.APP_URL).protocol === 'https:',
      ),
    dataService,
    debtService,
    expenseService,
    maxUploadSizeBytes: config.MAX_UPLOAD_SIZE_MB * 1_048_576,
    preferenceService,
    readinessCheck: () => verifyDatabaseConnection(database),
    subscriptionService,
  });

  await verifyDatabaseConnection(database);
  server.log.info('PostgreSQL connection verified');

  server.addHook('onClose', async () => {
    await database.destroy();
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, 'Shutting down');
    await server.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await server.listen({ host: config.API_HOST, port: config.API_PORT });
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`API startup failed: ${message}`);
  process.exitCode = 1;
});
