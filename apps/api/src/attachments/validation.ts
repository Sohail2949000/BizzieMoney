import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { once } from 'node:events';

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
};

const MAX_SNIFF_BYTES = 8192;
const UNSAFE_DISPLAY_CHARACTERS = /[<>:"/\\|?*]/g;

export class UploadValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

export interface StagedUpload {
  checksumSha256: string;
  cleanup(): Promise<void>;
  displayName: string;
  filePath: string;
  mimeType: string;
  originalFileName: string;
  sizeBytes: number;
}

function stripControlAndBidi(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        codePoint <= 0x1f ||
        codePoint === 0x7f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    })
    .join('');
}

function safeNames(fileName: string): {
  displayName: string;
  originalFileName: string;
} {
  const pathStripped = basename(fileName.replaceAll('\\', '/')).normalize(
    'NFKC',
  );
  const sanitizedPath = stripControlAndBidi(pathStripped).trim().slice(0, 255);
  const originalFileName = sanitizedPath || 'attachment';
  const displayName =
    originalFileName
      .replace(UNSAFE_DISPLAY_CHARACTERS, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'attachment';
  return { displayName, originalFileName };
}

function hasOnlyAllowedTextCharacters(text: string): boolean {
  return [...text].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !(
      (codePoint < 0x20 &&
        codePoint !== 0x09 &&
        codePoint !== 0x0a &&
        codePoint !== 0x0d) ||
      codePoint === 0x7f
    );
  });
}

function detectedMimeType(
  bytes: Buffer,
  extension: string,
  isCompleteUtf8Text: boolean,
): string | null {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return 'application/pdf';
  }
  if (isCompleteUtf8Text) {
    return extension === '.csv' ? 'text/csv' : 'text/plain';
  }
  return null;
}

function declaredTypeMatches(actual: string, declared: string): boolean {
  if (!declared || declared === 'application/octet-stream') return true;
  if (actual === declared) return true;
  return (
    (actual === 'image/jpeg' && declared === 'image/jpg') ||
    ((actual === 'text/csv' || actual === 'text/plain') &&
      (declared === 'text/csv' || declared === 'text/plain'))
  );
}

export async function stageAndValidateUpload({
  allowedMimeTypes,
  declaredMimeType,
  fileName,
  maxBytes,
  stream,
}: {
  allowedMimeTypes: ReadonlySet<string>;
  declaredMimeType: string;
  fileName: string;
  maxBytes: number;
  stream: Readable;
}): Promise<StagedUpload> {
  const names = safeNames(fileName);
  const extension = extname(names.displayName).toLocaleLowerCase('en-US');
  const directory = await mkdtemp(join(tmpdir(), 'bizziemoney-upload-'));
  const filePath = join(directory, 'payload');
  const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  const textDecoder = new TextDecoder('utf-8', { fatal: true });
  const sniffChunks: Array<Buffer<ArrayBufferLike>> = [];
  let sniffBytes = 0;
  let sizeBytes = 0;
  let isCompleteUtf8Text = true;

  try {
    for await (const rawChunk of stream as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(rawChunk);
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        throw new UploadValidationError(
          'ATTACHMENT_TOO_LARGE',
          `Choose a file smaller than ${Math.floor(maxBytes / 1_048_576)} MB.`,
          413,
        );
      }
      hash.update(chunk);
      if (isCompleteUtf8Text) {
        try {
          isCompleteUtf8Text = hasOnlyAllowedTextCharacters(
            textDecoder.decode(chunk, { stream: true }),
          );
        } catch {
          isCompleteUtf8Text = false;
        }
      }
      if (sniffBytes < MAX_SNIFF_BYTES) {
        const sample = chunk.subarray(0, MAX_SNIFF_BYTES - sniffBytes);
        sniffChunks.push(sample);
        sniffBytes += sample.length;
      }
      if (!output.write(chunk)) {
        await once(output, 'drain');
      }
    }
    output.end();
    await once(output, 'finish');
    if (isCompleteUtf8Text) {
      try {
        isCompleteUtf8Text = hasOnlyAllowedTextCharacters(textDecoder.decode());
      } catch {
        isCompleteUtf8Text = false;
      }
    }

    if (sizeBytes === 0) {
      throw new UploadValidationError(
        'ATTACHMENT_EMPTY',
        'Choose a file that is not empty.',
        400,
      );
    }
    const mimeType = detectedMimeType(
      Buffer.concat(sniffChunks, sniffBytes),
      extension,
      isCompleteUtf8Text,
    );
    if (!mimeType) {
      throw new UploadValidationError(
        'ATTACHMENT_TYPE_BLOCKED',
        'That file type is not supported.',
        415,
      );
    }
    if (!MIME_EXTENSIONS[mimeType]?.includes(extension)) {
      throw new UploadValidationError(
        'ATTACHMENT_EXTENSION_MISMATCH',
        'The file extension does not match its contents.',
        415,
      );
    }
    if (!declaredTypeMatches(mimeType, declaredMimeType)) {
      throw new UploadValidationError(
        'ATTACHMENT_MIME_MISMATCH',
        'The file type reported by the browser does not match its contents.',
        415,
      );
    }
    if (!allowedMimeTypes.has(mimeType)) {
      throw new UploadValidationError(
        'ATTACHMENT_TYPE_DISABLED',
        'That file type is disabled for this installation.',
        415,
      );
    }

    return {
      checksumSha256: hash.digest('hex'),
      cleanup: () => rm(directory, { force: true, recursive: true }),
      displayName: names.displayName,
      filePath,
      mimeType,
      originalFileName: names.originalFileName,
      sizeBytes,
    };
  } catch (error) {
    output.destroy();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

export const supportedAttachmentMimeTypes = Object.freeze(
  Object.keys(MIME_EXTENSIONS),
);
