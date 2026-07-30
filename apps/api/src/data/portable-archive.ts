import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';

import { storageFor, type StorageRegistry } from '@bizziemoney/storage';

import type { PortableAttachmentSource } from './types';

const TAR_BLOCK_SIZE = 512;

function writeString(
  target: Buffer,
  value: string,
  offset: number,
  length: number,
): void {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > length) {
    throw new Error(`Archive path or metadata is too long: ${value}`);
  }
  encoded.copy(target, offset, 0, encoded.length);
}

function writeOctal(
  target: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  const octal = Math.max(0, Math.floor(value)).toString(8);
  if (octal.length > length - 1) {
    throw new Error('Archive entry is too large.');
  }
  writeString(target, octal.padStart(length - 1, '0'), offset, length - 1);
  target[offset + length - 1] = 0;
}

export function createTarHeader(
  name: string,
  size: number,
  modifiedAt = new Date(),
): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor(modifiedAt.getTime() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 'ustar\0', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, 'BizzieMoney', 265, 32);
  writeString(header, 'BizzieMoney', 297, 32);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0');
  writeString(header, checksumText, 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

async function writeChunk(stream: Writable, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function writePadding(stream: Writable, size: number): Promise<void> {
  const remainder = size % TAR_BLOCK_SIZE;
  if (remainder !== 0) {
    await writeChunk(stream, Buffer.alloc(TAR_BLOCK_SIZE - remainder));
  }
}

async function writeReadable(
  output: Writable,
  input: Readable,
  expectedSize: number,
  expectedChecksum?: string,
): Promise<void> {
  let size = 0;
  const checksum = createHash('sha256');
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    size += chunk.length;
    if (size > expectedSize) {
      throw new Error('An exported attachment is larger than its metadata.');
    }
    checksum.update(chunk);
    await writeChunk(output, chunk);
  }
  if (size !== expectedSize) {
    throw new Error('An exported attachment does not match its stored size.');
  }
  if (expectedChecksum && checksum.digest('hex') !== expectedChecksum) {
    throw new Error('An exported attachment failed its integrity check.');
  }
  await writePadding(output, size);
}

async function addBuffer(
  output: Writable,
  name: string,
  content: Buffer,
  modifiedAt: Date,
): Promise<void> {
  await writeChunk(output, createTarHeader(name, content.length, modifiedAt));
  await writeChunk(output, content);
  await writePadding(output, content.length);
}

async function addFile(
  output: Writable,
  name: string,
  filePath: string,
  modifiedAt: Date,
): Promise<void> {
  const file = await stat(filePath);
  await writeChunk(output, createTarHeader(name, file.size, modifiedAt));
  await writeReadable(output, createReadStream(filePath), file.size);
}

export async function writePortableArchive({
  attachments,
  manifest,
  ownerId,
  outputPath,
  readme,
  recordsPath,
  storage,
}: {
  attachments: readonly PortableAttachmentSource[];
  manifest: Record<string, unknown>;
  ownerId: string;
  outputPath: string;
  readme: string;
  recordsPath: string;
  storage: StorageRegistry;
}): Promise<void> {
  const modifiedAt = new Date(String(manifest.exportedAt));
  const gzip = createGzip({ level: 9 });
  const file = createWriteStream(outputPath, { flags: 'wx' });
  const completed = new Promise<void>((resolve, reject) => {
    file.once('finish', resolve);
    file.once('error', reject);
    gzip.once('error', reject);
  });
  gzip.pipe(file);

  try {
    await addBuffer(
      gzip,
      'manifest.json',
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      modifiedAt,
    );
    await addBuffer(
      gzip,
      'README.txt',
      Buffer.from(readme, 'utf8'),
      modifiedAt,
    );
    await addFile(gzip, 'records.ndjson', recordsPath, modifiedAt);
    for (const attachment of attachments) {
      const adapter = await storageFor(
        storage,
        ownerId,
        attachment.storageProvider,
        attachment.storageRoot,
      );
      const object = await adapter.openObject(attachment.objectKey);
      if (
        object.contentLength !== undefined &&
        object.contentLength !== attachment.sizeBytes
      ) {
        object.body.destroy();
        throw new Error(
          'An exported attachment does not match its stored size.',
        );
      }
      await writeChunk(
        gzip,
        createTarHeader(
          attachment.archivePath,
          attachment.sizeBytes,
          modifiedAt,
        ),
      );
      await writeReadable(
        gzip,
        object.body,
        attachment.sizeBytes,
        attachment.checksumSha256,
      );
    }
    await writeChunk(gzip, Buffer.alloc(TAR_BLOCK_SIZE * 2));
    gzip.end();
    await completed;
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error('Archive failed.'));
    file.destroy();
    await completed.catch(() => undefined);
    throw error;
  }
}
