import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { BizzieMoneyDatabase } from '@bizziemoney/database';
import type { AttachmentStorage, StorageRegistry } from '@bizziemoney/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupArchiveService, type CommandRunner } from './backup-archive';

const temporaryRoots: string[] = [];
const unusedRegistry = {} as StorageRegistry;
const unusedDatabase = {} as BizzieMoneyDatabase;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('backup archive recovery boundaries', () => {
  it('rejects traversal entries before extracting an archive', async () => {
    const bytes = Buffer.from('synthetic archive');
    const storage: AttachmentStorage = {
      deleteObject: vi.fn(),
      openObject: vi.fn(() =>
        Promise.resolve({
          body: Readable.from(bytes),
          contentLength: bytes.length,
        }),
      ),
      provider: 'local',
      putFile: vi.fn(),
      rootIdentifier: '/safe/backups',
      testConnection: vi.fn(),
    };
    const run = vi.fn<CommandRunner['run']>(() =>
      Promise.resolve({ stderr: '', stdout: '../escape.sql\n' }),
    );
    const service = new BackupArchiveService(
      unusedDatabase,
      'postgresql://user:password@localhost:5432/bizziemoney',
      unusedRegistry,
      { run },
    );

    await expect(
      service.extractArtifact({
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        encrypted: false,
        encryptionPassword: null,
        objectKey: 'automatic/safe.bzm',
        storage,
      }),
    ).rejects.toThrow('BACKUP_ARCHIVE_PATH_INVALID');
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toContain('-tzf');
  });

  it('builds a single-transaction PostgreSQL restore script', async () => {
    const payloadDirectory = await mkdtemp(
      join(tmpdir(), 'bizziemoney-restore-script-test-'),
    );
    temporaryRoots.push(payloadDirectory);
    await writeFile(
      join(payloadDirectory, 'database.sql'),
      "insert into app_settings (owner_id) values ('00000000-0000-4000-8000-000000000001');\n",
    );
    let restoreSql = '';
    const run = vi.fn<CommandRunner['run']>(async (_command, args) => {
      const fileArgument = args.find((argument) =>
        argument.startsWith('--file='),
      );
      if (fileArgument) {
        restoreSql = await readFile(fileArgument.slice(7), 'utf8');
      }
      return { stderr: '', stdout: '' };
    });
    const service = new BackupArchiveService(
      unusedDatabase,
      'postgresql://user:password@localhost:5432/bizziemoney',
      unusedRegistry,
      { run },
    );

    await service.restoreDatabase(payloadDirectory);

    expect(run).toHaveBeenCalledOnce();
    const call = run.mock.calls[0];
    expect(call?.[0]).toBe('psql');
    expect(call?.[1]).toEqual(
      expect.arrayContaining(['--set=ON_ERROR_STOP=1', '--single-transaction']),
    );
    expect(call?.[2]?.environment).toBeDefined();
    expect(restoreSql).toMatch(
      /^alter table public\.entity_attachments\s+disable trigger entity_attachments_validate_owner;/,
    );
    expect(restoreSql).toContain('truncate table public.app_settings,');
    expect(restoreSql).toContain('insert into app_settings');
    expect(restoreSql).toContain(
      "raise exception 'restored attachment entity is unavailable';",
    );
    expect(restoreSql).toMatch(
      /alter table public\.entity_attachments\s+enable trigger entity_attachments_validate_owner;/,
    );
  });
});
