import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachmentObjectKeys,
  supportsAttachmentThumbnail,
  thumbnailObjectKey,
} from './thumbnail-keys';
import { generateThumbnail, THUMBNAIL_EDGE_PX } from './thumbnail';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('attachment thumbnails', () => {
  it('creates a bounded WebP thumbnail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bizziemoney-thumbnail-test-'));
    temporaryRoots.push(root);
    const source = join(root, 'source.png');
    await sharp({
      create: {
        background: { alpha: 1, b: 190, g: 90, r: 40 },
        channels: 4,
        height: 320,
        width: 640,
      },
    })
      .png()
      .toFile(source);

    const generated = await generateThumbnail(source);
    const metadata = await sharp(await readFile(generated.filePath)).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.height).toBe(THUMBNAIL_EDGE_PX);
    expect(metadata.width).toBe(THUMBNAIL_EDGE_PX);
    expect(generated.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.sizeBytes).toBeGreaterThan(0);
  });

  it('derives image-only cache keys beside the original object', () => {
    const original = 'attachments/owner/attachment/original';
    expect(supportsAttachmentThumbnail('image/png')).toBe(true);
    expect(supportsAttachmentThumbnail('application/pdf')).toBe(false);
    expect(thumbnailObjectKey(original)).toBe(
      'attachments/owner/attachment/thumbnail.webp',
    );
    expect(attachmentObjectKeys(original, 'image/jpeg')).toEqual([
      original,
      'attachments/owner/attachment/thumbnail.webp',
    ]);
    expect(attachmentObjectKeys(original, 'text/plain')).toEqual([original]);
  });
});
