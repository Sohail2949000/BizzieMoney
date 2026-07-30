import type { Readable } from 'node:stream';

export type StorageProvider = 'local' | 's3';

export interface StoredObject {
  body: Readable;
  contentLength: number | undefined;
}

export interface PutFileInput {
  checksumSha256: string;
  filePath: string;
  mimeType: string;
  objectKey: string;
}

export interface AttachmentStorage {
  readonly provider: StorageProvider;
  readonly rootIdentifier: string;
  deleteObject(objectKey: string): Promise<void>;
  openObject(objectKey: string): Promise<StoredObject>;
  putFile(input: PutFileInput): Promise<void>;
  testConnection(): Promise<void>;
}

export interface StorageRegistry {
  readonly active: AttachmentStorage;
  availableProviders(): StorageProvider[];
  get(provider: StorageProvider, rootIdentifier: string): AttachmentStorage;
  activeFor?(ownerId: string): Promise<AttachmentStorage>;
  availableProvidersFor?(ownerId: string): Promise<StorageProvider[]>;
  getFor?(
    ownerId: string,
    provider: StorageProvider,
    rootIdentifier: string,
  ): Promise<AttachmentStorage>;
}
