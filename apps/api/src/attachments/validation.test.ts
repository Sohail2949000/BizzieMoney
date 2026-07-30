import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { stageAndValidateUpload } from './validation';

const allowed = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

describe('attachment upload validation', () => {
  it('sniffs content and sanitizes untrusted file names', async () => {
    const staged = await stageAndValidateUpload({
      allowedMimeTypes: allowed,
      declaredMimeType: 'application/pdf',
      fileName: '..\\..\\invoice<>.pdf',
      maxBytes: 1_024,
      stream: Readable.from(Buffer.from('%PDF-1.7\nsafe test')),
    });
    try {
      expect(staged.mimeType).toBe('application/pdf');
      expect(staged.displayName).toBe('invoice__.pdf');
      expect(staged.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await staged.cleanup();
    }
  });

  it('blocks executable content even when it has an allowed name', async () => {
    await expect(
      stageAndValidateUpload({
        allowedMimeTypes: allowed,
        declaredMimeType: 'application/pdf',
        fileName: 'report.pdf',
        maxBytes: 1_024,
        stream: Readable.from(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_TYPE_BLOCKED',
      statusCode: 415,
    });
  });

  it('validates the entire contents of text files, not only the sniff window', async () => {
    await expect(
      stageAndValidateUpload({
        allowedMimeTypes: allowed,
        declaredMimeType: 'text/plain',
        fileName: 'notes.txt',
        maxBytes: 10_000,
        stream: Readable.from(
          Buffer.concat([Buffer.alloc(9_000, 0x41), Buffer.from([0])]),
        ),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_TYPE_BLOCKED',
      statusCode: 415,
    });
  });

  it('rejects extension and MIME spoofing', async () => {
    await expect(
      stageAndValidateUpload({
        allowedMimeTypes: allowed,
        declaredMimeType: 'image/png',
        fileName: 'photo.png',
        maxBytes: 1_024,
        stream: Readable.from(Buffer.from('%PDF-1.7\nnot an image')),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_EXTENSION_MISMATCH',
    });
  });

  it('stops streams that exceed the configured limit', async () => {
    await expect(
      stageAndValidateUpload({
        allowedMimeTypes: allowed,
        declaredMimeType: 'text/plain',
        fileName: 'notes.txt',
        maxBytes: 4,
        stream: Readable.from(Buffer.from('too large')),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_TOO_LARGE',
      statusCode: 413,
    });
  });
});
