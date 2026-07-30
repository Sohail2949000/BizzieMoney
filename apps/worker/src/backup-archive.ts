import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import type { BizzieMoneyDatabase } from '@bizziemoney/database';
import {
  storageFor,
  type AttachmentStorage,
  type StorageRegistry,
} from '@bizziemoney/storage';
import { z } from 'zod';

const scryptAsync = promisify(scrypt);
const ENCRYPTED_MAGIC = Buffer.from('BZMENC1\n', 'ascii');
const ENCRYPTED_HEADER_BYTES = ENCRYPTED_MAGIC.length + 16 + 12;
const AUTH_TAG_BYTES = 16;

export const BACKUP_TABLES = [
  'app_settings',
  'attachment_storage_s3_profiles',
  'attachment_storage_configs',
  'categories',
  'payment_methods',
  'tags',
  'expenses',
  'expense_tags',
  'expense_creation_requests',
  'expense_import_requests',
  'financial_purge_requests',
  'subscriptions',
  'subscription_payments',
  'subscription_payment_requests',
  'subscription_conversion_requests',
  'subscription_reminders',
  'debts',
  'debt_payments',
  'debt_payment_requests',
  'attachments',
  'entity_attachments',
  'attachment_upload_requests',
] as const;

const manifestSchema = z.object({
  applicationVersion: z.string().min(1),
  attachmentCount: z.number().int().nonnegative(),
  attachments: z.array(
    z.object({
      archivePath: z.string().nullable(),
      checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
      id: z.uuid(),
      objectKey: z.string().min(1),
      sizeBytes: z.string().regex(/^\d+$/),
      storageProvider: z.enum(['local', 's3']),
      storageRoot: z.string().min(1),
    }),
  ),
  backupCreatedAt: z.iso.datetime(),
  fileChecksums: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  formatVersion: z.literal(1),
  includesAttachments: z.boolean(),
  ownerId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  tables: z.record(z.string(), z.number().int().nonnegative()),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: { environment?: NodeJS.ProcessEnv },
  ): Promise<CommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options?: { environment?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: options?.environment ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(-100_000);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-20_000);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) {
          resolve({ stderr, stdout });
          return;
        }
        reject(
          new Error(
            `${command.toLocaleUpperCase('en-US')}_FAILED:${stderr.trim()}`,
          ),
        );
      });
    });
  }
}

export interface PreparedBackup {
  checksumSha256: string;
  cleanup(): Promise<void>;
  encrypted: boolean;
  filePath: string;
  manifest: BackupManifest;
  sizeBytes: number;
}

export interface ExtractedBackup {
  cleanup(): Promise<void>;
  manifest: BackupManifest;
  payloadDirectory: string;
}

export interface BackupArchive {
  extractArtifact(input: {
    checksumSha256: string;
    encrypted: boolean;
    encryptionPassword: string | null;
    objectKey: string;
    storage: AttachmentStorage;
  }): Promise<ExtractedBackup>;
  prepareBackup(input: {
    applicationVersion: string;
    encryptionPassword: string | null;
    includeAttachments: boolean;
    ownerId: string;
    schemaVersion: number;
  }): Promise<PreparedBackup>;
  restoreAttachments(
    payloadDirectory: string,
    manifest: BackupManifest,
  ): Promise<void>;
  restoreDatabase(payloadDirectory: string): Promise<void>;
  verifyStoredObject(
    storage: AttachmentStorage,
    objectKey: string,
    expectedChecksum: string,
  ): Promise<void>;
}

interface AttachmentCopyRecord {
  checksum_sha256: string;
  id: string;
  object_key: string;
  size_bytes: string;
  storage_provider: 'local' | 's3';
  storage_root: string;
}

function postgresCommandEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const connection = new URL(databaseUrl);
  if (
    connection.protocol !== 'postgres:' &&
    connection.protocol !== 'postgresql:'
  ) {
    throw new Error('DATABASE_URL_INVALID');
  }
  const databaseName = decodeURIComponent(connection.pathname.slice(1));
  if (!connection.hostname || !databaseName) {
    throw new Error('DATABASE_URL_INVALID');
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGCONNECT_TIMEOUT: '15',
    PGDATABASE: databaseName,
    PGHOST: connection.hostname,
    PGPASSWORD: decodeURIComponent(connection.password),
    PGPORT: connection.port || '5432',
    PGUSER: decodeURIComponent(connection.username),
  };
  const supportedOptions = {
    application_name: 'PGAPPNAME',
    options: 'PGOPTIONS',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
  } as const;
  for (const [queryName, environmentName] of Object.entries(supportedOptions)) {
    const value = connection.searchParams.get(queryName);
    if (value) environment[environmentName] = value;
  }
  return environment;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function writeEncryptedFile(
  inputPath: string,
  outputPath: string,
  password: string,
): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const output = await open(outputPath, 'wx', 0o600);
  try {
    await output.write(Buffer.concat([ENCRYPTED_MAGIC, salt, iv]));
    for await (const chunk of createReadStream(inputPath)) {
      await output.write(cipher.update(chunk as Buffer));
    }
    await output.write(cipher.final());
    await output.write(cipher.getAuthTag());
  } finally {
    await output.close();
  }
}

async function writeDecryptedFile(
  inputPath: string,
  outputPath: string,
  password: string,
): Promise<void> {
  const file = await open(inputPath, 'r');
  try {
    const fileInfo = await file.stat();
    if (fileInfo.size <= ENCRYPTED_HEADER_BYTES + AUTH_TAG_BYTES) {
      throw new Error('BACKUP_ENCRYPTED_FILE_INVALID');
    }
    const header = Buffer.alloc(ENCRYPTED_HEADER_BYTES);
    await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)) {
      throw new Error('BACKUP_ENCRYPTED_FILE_INVALID');
    }
    const tag = Buffer.alloc(AUTH_TAG_BYTES);
    await file.read(tag, 0, tag.length, fileInfo.size - AUTH_TAG_BYTES);
    const salt = header.subarray(
      ENCRYPTED_MAGIC.length,
      ENCRYPTED_MAGIC.length + 16,
    );
    const iv = header.subarray(ENCRYPTED_MAGIC.length + 16);
    const key = (await scryptAsync(password, salt, 32)) as Buffer;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(inputPath, {
        end: fileInfo.size - AUTH_TAG_BYTES - 1,
        start: ENCRYPTED_HEADER_BYTES,
      }),
      decipher,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(outputPath, { force: true });
    if (
      error instanceof Error &&
      error.message === 'BACKUP_ENCRYPTED_FILE_INVALID'
    ) {
      throw error;
    }
    throw new Error('BACKUP_PASSWORD_INCORRECT', { cause: error });
  } finally {
    await file.close();
  }
}

function safeArchiveEntries(output: string): void {
  const entries = output
    .split(/\r?\n/)
    .map((entry) => entry.trim().replace(/^\.\//, ''))
    .filter(Boolean);
  if (
    entries.length > 10_000 ||
    entries.some(
      (entry) =>
        entry.startsWith('/') || entry.split('/').some((part) => part === '..'),
    )
  ) {
    throw new Error('BACKUP_ARCHIVE_PATH_INVALID');
  }
}

export class BackupArchiveService implements BackupArchive {
  constructor(
    private readonly database: BizzieMoneyDatabase,
    private readonly databaseUrl: string,
    private readonly attachmentStorage: StorageRegistry,
    private readonly commandRunner: CommandRunner = new SpawnCommandRunner(),
  ) {}

  async prepareBackup(input: {
    applicationVersion: string;
    encryptionPassword: string | null;
    includeAttachments: boolean;
    ownerId: string;
    schemaVersion: number;
  }): Promise<PreparedBackup> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'bizziemoney-backup-'));
    const payloadDirectory = join(temporaryRoot, 'payload');
    const databaseDumpPath = join(payloadDirectory, 'database.sql');
    await mkdir(payloadDirectory, { mode: 0o700, recursive: true });

    try {
      const dumpArgs = [
        '--data-only',
        '--no-owner',
        '--no-privileges',
        '--encoding=UTF8',
        `--file=${databaseDumpPath}`,
        ...BACKUP_TABLES.map((table) => `--table=public.${table}`),
      ];
      await this.commandRunner.run('pg_dump', dumpArgs, {
        environment: postgresCommandEnvironment(this.databaseUrl),
      });

      const attachmentRows = await this.database
        .selectFrom('attachments')
        .select([
          'checksum_sha256',
          'id',
          'object_key',
          'size_bytes',
          'storage_provider',
          'storage_root',
        ])
        .where('owner_id', '=', input.ownerId)
        .where('deleted_at', 'is', null)
        .orderBy('id')
        .execute();
      const fileChecksums: Record<string, string> = {
        'database.sql': await hashFile(databaseDumpPath),
      };
      const attachments: BackupManifest['attachments'] = [];
      if (input.includeAttachments) {
        await mkdir(join(payloadDirectory, 'attachments'), {
          mode: 0o700,
          recursive: true,
        });
      }
      for (const row of attachmentRows as AttachmentCopyRecord[]) {
        const archivePath = input.includeAttachments
          ? `attachments/${row.id}`
          : null;
        if (archivePath) {
          const adapter = await storageFor(
            this.attachmentStorage,
            input.ownerId,
            row.storage_provider,
            row.storage_root,
          );
          const source = await adapter.openObject(row.object_key);
          const targetPath = join(payloadDirectory, archivePath);
          await pipeline(
            source.body,
            createWriteStream(targetPath, { flags: 'wx', mode: 0o600 }),
          );
          const checksum = await hashFile(targetPath);
          if (checksum !== row.checksum_sha256) {
            throw new Error('BACKUP_ATTACHMENT_CHECKSUM_MISMATCH');
          }
          fileChecksums[archivePath] = checksum;
        }
        attachments.push({
          archivePath,
          checksumSha256: row.checksum_sha256,
          id: row.id,
          objectKey: row.object_key,
          sizeBytes: row.size_bytes,
          storageProvider: row.storage_provider,
          storageRoot: row.storage_root,
        });
      }

      const tableCounts = await this.readTableCounts();
      const manifest: BackupManifest = {
        applicationVersion: input.applicationVersion,
        attachmentCount: attachments.length,
        attachments,
        backupCreatedAt: new Date().toISOString(),
        fileChecksums,
        formatVersion: 1,
        includesAttachments: input.includeAttachments,
        ownerId: input.ownerId,
        schemaVersion: input.schemaVersion,
        tables: tableCounts,
      };
      await writeFile(
        join(payloadDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );

      const archivePath = join(temporaryRoot, 'backup.tar.gz');
      await this.commandRunner.run('tar', [
        '-czf',
        archivePath,
        '-C',
        payloadDirectory,
        '.',
      ]);
      const encrypted = Boolean(input.encryptionPassword);
      const finalPath = encrypted
        ? join(temporaryRoot, 'backup.bzm.enc')
        : join(temporaryRoot, 'backup.bzm');
      if (input.encryptionPassword) {
        await writeEncryptedFile(
          archivePath,
          finalPath,
          input.encryptionPassword,
        );
      } else {
        await pipeline(
          createReadStream(archivePath),
          createWriteStream(finalPath, { flags: 'wx', mode: 0o600 }),
        );
      }
      const fileInfo = await stat(finalPath);
      return {
        checksumSha256: await hashFile(finalPath),
        cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
        encrypted,
        filePath: finalPath,
        manifest,
        sizeBytes: fileInfo.size,
      };
    } catch (error) {
      await rm(temporaryRoot, { force: true, recursive: true });
      throw error;
    }
  }

  async extractArtifact(input: {
    checksumSha256: string;
    encrypted: boolean;
    encryptionPassword: string | null;
    objectKey: string;
    storage: AttachmentStorage;
  }): Promise<ExtractedBackup> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'bizziemoney-restore-'));
    const storedPath = join(temporaryRoot, 'stored.bzm');
    const archivePath = join(temporaryRoot, 'archive.tar.gz');
    const payloadDirectory = join(temporaryRoot, 'payload');
    await mkdir(payloadDirectory, { mode: 0o700, recursive: true });
    try {
      const stored = await input.storage.openObject(input.objectKey);
      await pipeline(
        stored.body,
        createWriteStream(storedPath, { flags: 'wx', mode: 0o600 }),
      );
      if ((await hashFile(storedPath)) !== input.checksumSha256) {
        throw new Error('BACKUP_ARTIFACT_CHECKSUM_MISMATCH');
      }
      if (input.encrypted) {
        if (!input.encryptionPassword) {
          throw new Error('BACKUP_PASSWORD_UNAVAILABLE');
        }
        await writeDecryptedFile(
          storedPath,
          archivePath,
          input.encryptionPassword,
        );
      } else {
        await pipeline(
          createReadStream(storedPath),
          createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }),
        );
      }
      const listing = await this.commandRunner.run('tar', [
        '-tzf',
        archivePath,
      ]);
      safeArchiveEntries(listing.stdout);
      await this.commandRunner.run('tar', [
        '-xzf',
        archivePath,
        '-C',
        payloadDirectory,
      ]);
      const manifest = manifestSchema.parse(
        JSON.parse(
          await readFile(join(payloadDirectory, 'manifest.json'), 'utf8'),
        ) as unknown,
      );
      for (const [relativePath, expected] of Object.entries(
        manifest.fileChecksums,
      )) {
        if (
          relativePath.startsWith('/') ||
          relativePath.split('/').includes('..')
        ) {
          throw new Error('BACKUP_ARCHIVE_PATH_INVALID');
        }
        if (
          (await hashFile(join(payloadDirectory, relativePath))) !== expected
        ) {
          throw new Error('BACKUP_CONTENT_CHECKSUM_MISMATCH');
        }
      }
      return {
        cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
        manifest,
        payloadDirectory,
      };
    } catch (error) {
      await rm(temporaryRoot, { force: true, recursive: true });
      throw error;
    }
  }

  async restoreDatabase(payloadDirectory: string): Promise<void> {
    const combinedPath = join(payloadDirectory, 'restore.sql');
    const handle = await open(combinedPath, 'wx', 0o600);
    try {
      await handle.write(
        [
          'alter table public.entity_attachments',
          '  disable trigger entity_attachments_validate_owner;',
          `truncate table ${BACKUP_TABLES.map((table) => `public.${table}`).join(', ')};`,
          '',
        ].join('\n'),
      );
      for await (const chunk of createReadStream(
        join(payloadDirectory, 'database.sql'),
      )) {
        await handle.write(chunk as Buffer);
      }
      await handle.write(
        [
          '',
          'do $restore_validation$',
          'begin',
          '  if exists (',
          '    select 1',
          '    from public.entity_attachments as link',
          '    where not (',
          "      (link.entity_type = 'expense' and exists (",
          '        select 1 from public.expenses as entity',
          '        where entity.owner_id = link.owner_id',
          '          and entity.id = link.entity_id',
          '          and entity.deleted_at is null',
          '      ))',
          "      or (link.entity_type = 'subscription' and exists (",
          '        select 1 from public.subscriptions as entity',
          '        where entity.owner_id = link.owner_id',
          '          and entity.id = link.entity_id',
          '          and entity.deleted_at is null',
          '      ))',
          "      or (link.entity_type = 'debt' and exists (",
          '        select 1 from public.debts as entity',
          '        where entity.owner_id = link.owner_id',
          '          and entity.id = link.entity_id',
          '          and entity.deleted_at is null',
          '      ))',
          "      or (link.entity_type = 'debt_payment' and exists (",
          '        select 1 from public.debt_payments as entity',
          '        where entity.owner_id = link.owner_id',
          '          and entity.id = link.entity_id',
          '          and entity.deleted_at is null',
          '      ))',
          '    )',
          '  ) then',
          "    raise exception 'restored attachment entity is unavailable';",
          '  end if;',
          'end;',
          '$restore_validation$;',
          'alter table public.entity_attachments',
          '  enable trigger entity_attachments_validate_owner;',
          '',
        ].join('\n'),
      );
    } finally {
      await handle.close();
    }
    await this.commandRunner.run(
      'psql',
      [
        '--set=ON_ERROR_STOP=1',
        '--single-transaction',
        `--file=${combinedPath}`,
      ],
      {
        environment: postgresCommandEnvironment(this.databaseUrl),
      },
    );
  }

  async restoreAttachments(
    payloadDirectory: string,
    manifest: BackupManifest,
  ): Promise<void> {
    for (const attachment of manifest.attachments) {
      if (!attachment.archivePath) continue;
      const storage = await storageFor(
        this.attachmentStorage,
        manifest.ownerId,
        attachment.storageProvider,
        attachment.storageRoot,
      );
      await storage.putFile({
        checksumSha256: attachment.checksumSha256,
        filePath: join(payloadDirectory, attachment.archivePath),
        mimeType: 'application/octet-stream',
        objectKey: attachment.objectKey,
      });
    }
  }

  async verifyStoredObject(
    storage: AttachmentStorage,
    objectKey: string,
    expectedChecksum: string,
  ): Promise<void> {
    const stored = await storage.openObject(objectKey);
    const hash = createHash('sha256');
    for await (const chunk of stored.body) {
      hash.update(chunk as Buffer);
    }
    if (hash.digest('hex') !== expectedChecksum) {
      throw new Error('BACKUP_UPLOAD_CHECKSUM_MISMATCH');
    }
  }

  private async readTableCounts(): Promise<Record<string, number>> {
    const [settings, expenses, subscriptions, debts, payments, attachments] =
      await Promise.all([
        this.database
          .selectFrom('app_settings')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('expenses')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('subscriptions')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('debts')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('debt_payments')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        this.database
          .selectFrom('attachments')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
      ]);
    return {
      appSettings: Number(settings.count),
      attachments: Number(attachments.count),
      debtPayments: Number(payments.count),
      debts: Number(debts.count),
      expenses: Number(expenses.count),
      subscriptions: Number(subscriptions.count),
    };
  }
}
