import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalAttachmentStorage } from './local';

describe('LocalAttachmentStorage', () => {
  it('writes, reads, and idempotently deletes generated object keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bizziemoney-storage-test-'));
    const source = join(root, 'source.txt');
    await writeFile(source, 'receipt');
    const storage = new LocalAttachmentStorage(join(root, 'objects'));
    const objectKey =
      'attachments/00000000-0000-4000-8000-000000000001/' +
      '00000000-0000-4000-8000-000000000002/backup.bzm';

    try {
      await storage.putFile({
        checksumSha256: 'unused-by-local-storage',
        filePath: source,
        mimeType: 'text/plain',
        objectKey,
      });
      const stored = await storage.openObject(objectKey);
      const chunks: Array<Buffer<ArrayBufferLike>> = [];
      for await (const chunk of stored.body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString('utf8')).toBe('receipt');
      expect(await readFile(join(root, 'objects', objectKey), 'utf8')).toBe(
        'receipt',
      );
      await storage.deleteObject(objectKey);
      await expect(storage.deleteObject(objectKey)).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects traversal and absolute object keys', async () => {
    const storage = new LocalAttachmentStorage('/tmp/bizziemoney-storage-test');
    await expect(storage.openObject('../secret')).rejects.toThrow(
      'STORAGE_OBJECT_KEY_INVALID',
    );
    await expect(storage.openObject('folder/./secret')).rejects.toThrow(
      'STORAGE_OBJECT_KEY_INVALID',
    );
    await expect(storage.openObject('/absolute')).rejects.toThrow(
      'STORAGE_OBJECT_KEY_INVALID',
    );
  });
});
