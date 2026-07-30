import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readMigrationFiles } from './migrations';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('readMigrationFiles', () => {
  it('returns versioned SQL files in stable order with checksums', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'bm-migrations-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, '0002_second.sql'), 'select 2;\n');
    await writeFile(path.join(directory, '0001_first.sql'), 'select 1;\n');
    await writeFile(path.join(directory, 'notes.txt'), 'ignored');

    const migrations = await readMigrationFiles(directory);

    expect(migrations.map(({ name }) => name)).toEqual([
      '0001_first.sql',
      '0002_second.sql',
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
