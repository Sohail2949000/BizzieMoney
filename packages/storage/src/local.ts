import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { AttachmentStorage, PutFileInput, StoredObject } from './types';

const SAFE_OBJECT_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,511}$/;

export class LocalAttachmentStorage implements AttachmentStorage {
  readonly provider = 'local' as const;
  readonly rootIdentifier: string;

  constructor(rootPath: string) {
    this.rootIdentifier = resolve(rootPath);
  }

  async putFile(input: PutFileInput): Promise<void> {
    const targetPath = this.resolveObjectKey(input.objectKey);
    const temporaryPath = `${targetPath}.partial-${randomUUID()}`;
    await mkdir(dirname(targetPath), { mode: 0o700, recursive: true });
    try {
      await pipeline(
        createReadStream(input.filePath),
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
      );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async openObject(objectKey: string): Promise<StoredObject> {
    const filePath = this.resolveObjectKey(objectKey);
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('STORAGE_OBJECT_UNAVAILABLE');
    return {
      body: createReadStream(filePath),
      contentLength: file.size,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const filePath = this.resolveObjectKey(objectKey);
    try {
      await unlink(filePath);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  async testConnection(): Promise<void> {
    await mkdir(this.rootIdentifier, { mode: 0o700, recursive: true });
    await access(this.rootIdentifier);
  }

  private resolveObjectKey(objectKey: string): string {
    if (
      !SAFE_OBJECT_KEY.test(objectKey) ||
      objectKey
        .split('/')
        .some((part) => part === '..' || part === '.' || part === '')
    ) {
      throw new Error('STORAGE_OBJECT_KEY_INVALID');
    }
    const resolvedPath = resolve(this.rootIdentifier, objectKey);
    if (!resolvedPath.startsWith(`${this.rootIdentifier}${sep}`)) {
      throw new Error('STORAGE_OBJECT_KEY_INVALID');
    }
    return resolvedPath;
  }
}
