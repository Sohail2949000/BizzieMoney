import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { AttachmentStorage, StorageRegistry } from '@bizziemoney/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { createTarHeader, writePortableArchive } from './portable-archive';

const temporaryDirectories: string[] = [];

function parseTar(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim() ||
        '0',
      8,
    );
    offset += 512;
    entries.set(name, archive.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('portable archive', () => {
  it('writes a valid USTAR checksum', () => {
    const header = createTarHeader(
      'manifest.json',
      42,
      new Date('2026-07-29T00:00:00.000Z'),
    );
    const stored = Number.parseInt(
      header.subarray(148, 154).toString('ascii'),
      8,
    );
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const calculated = checksumHeader.reduce((total, byte) => total + byte, 0);

    expect(header.subarray(257, 263).toString('ascii')).toBe('ustar\0');
    expect(stored).toBe(calculated);
  });

  it('contains readable records and checksum-verified attachments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bm-archive-test-'));
    temporaryDirectories.push(directory);
    const recordsPath = join(directory, 'records.ndjson');
    const outputPath = join(directory, 'export.tar.gz');
    await writeFile(
      recordsPath,
      '{"type":"expense","data":{"description":"Coffee"}}\n',
    );
    const attachment = Buffer.from('receipt bytes');
    const checksumSha256 = createHash('sha256')
      .update(attachment)
      .digest('hex');
    const adapter: AttachmentStorage = {
      deleteObject: () => Promise.resolve(),
      openObject: () =>
        Promise.resolve({
          body: Readable.from(attachment),
          contentLength: attachment.length,
        }),
      provider: 'local',
      putFile: () => Promise.resolve(),
      rootIdentifier: 'test-root',
      testConnection: () => Promise.resolve(),
    };
    const storage: StorageRegistry = {
      active: adapter,
      availableProviders: () => ['local'],
      get: () => adapter,
    };

    await writePortableArchive({
      attachments: [
        {
          archivePath:
            'attachments/00000000-0000-4000-8000-000000000001/original',
          checksumSha256,
          id: '00000000-0000-4000-8000-000000000001',
          objectKey: 'receipt',
          sizeBytes: attachment.length,
          storageProvider: 'local',
          storageRoot: 'test-root',
        },
      ],
      manifest: {
        exportedAt: '2026-07-29T00:00:00.000Z',
        format: 'bizziemoney-portable-export',
      },
      ownerId: '00000000-0000-4000-8000-000000000002',
      outputPath,
      readme: 'Private export\n',
      recordsPath,
      storage,
    });

    const entries = parseTar(gunzipSync(await readFile(outputPath)));
    expect(entries.get('manifest.json')?.toString('utf8')).toContain(
      'bizziemoney-portable-export',
    );
    expect(entries.get('records.ndjson')?.toString('utf8')).toContain('Coffee');
    expect(
      entries.get('attachments/00000000-0000-4000-8000-000000000001/original'),
    ).toEqual(attachment);
  });
});
