import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

export const THUMBNAIL_EDGE_PX = 160;

export interface GeneratedThumbnail {
  checksumSha256: string;
  filePath: string;
  sizeBytes: number;
}

export async function generateThumbnail(
  sourceFilePath: string,
): Promise<GeneratedThumbnail> {
  const filePath = join(dirname(sourceFilePath), 'thumbnail.webp');
  await sharp(sourceFilePath, {
    animated: false,
    failOn: 'error',
    limitInputPixels: 40_000_000,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      fit: 'cover',
      height: THUMBNAIL_EDGE_PX,
      width: THUMBNAIL_EDGE_PX,
      withoutEnlargement: true,
    })
    .webp({ effort: 4, quality: 72 })
    .toFile(filePath);

  const [bytes, file] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    filePath,
    sizeBytes: file.size,
  };
}
