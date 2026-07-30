import type { Readable } from 'node:stream';

import type { StorageProvider, StoredObject } from '@bizziemoney/storage';

export type AttachmentEntityType =
  'debt' | 'debt_payment' | 'expense' | 'subscription';

export interface AttachmentRecord {
  checksumSha256: string;
  createdAt: Date;
  displayName: string;
  id: string;
  mimeType: string;
  objectKey: string;
  originalFileName: string;
  ownerId: string;
  sizeBytes: string;
  storageProvider: StorageProvider;
  storageRoot: string;
  updatedAt: Date;
}

export interface PublicAttachment {
  checksumSha256: string;
  createdAt: string;
  displayName: string;
  id: string;
  mimeType: string;
  previewSupported: boolean;
  sizeBytes: number;
  thumbnailAvailable: boolean;
  updatedAt: string;
}

export interface AttachmentStorageStatus {
  allowedMimeTypes: string[];
  availableProviders: StorageProvider[];
  configuration: PublicAttachmentStorageConfig;
  fileCount: number;
  malwareScanner: MalwareScannerStatus;
  maxUploadSizeBytes: number;
  provider: StorageProvider;
  providerLabel: string;
  totalSizeBytes: number;
}

export interface AttachmentStorageS3Input {
  accessKeyId?: string | undefined;
  bucket: string;
  endpoint: string | null;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  removeCredentials?: boolean | undefined;
  secretAccessKey?: string | undefined;
}

export interface AttachmentStorageConfigInput {
  provider: StorageProvider;
  s3: AttachmentStorageS3Input | null;
}

export interface PublicAttachmentStorageConfig {
  provider: StorageProvider;
  source: 'environment' | 'settings';
  s3: {
    bucket: string;
    endpoint: string | null;
    forcePathStyle: boolean;
    hasCredentials: boolean;
    prefix: string;
    region: string;
  } | null;
  updatedAt: string | null;
}

export interface AttachmentContent {
  attachment: AttachmentRecord;
  object: StoredObject;
}

export interface AttachmentUploadInput {
  declaredMimeType: string;
  entityId: string;
  entityType: AttachmentEntityType;
  fileName: string;
  idempotencyKey: string;
  ownerId: string;
  sessionId: string;
  stream: Readable;
}

export interface CreateAttachmentStoreInput {
  attachmentId: string;
  checksumSha256: string;
  displayName: string;
  entityId: string;
  entityType: AttachmentEntityType;
  idempotencyKey: string;
  mimeType: string;
  now: Date;
  objectKey: string;
  originalFileName: string;
  ownerId: string;
  requestHash: string;
  sessionId: string;
  sizeBytes: number;
  storageProvider: StorageProvider;
  storageRoot: string;
}

export interface AttachmentServiceContract {
  deleteAttachment(
    ownerId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<void>;
  getContent(ownerId: string, attachmentId: string): Promise<AttachmentContent>;
  getThumbnail(
    ownerId: string,
    attachmentId: string,
  ): Promise<AttachmentContent>;
  getStorageStatus(ownerId: string): Promise<AttachmentStorageStatus>;
  listDebtAttachments(
    ownerId: string,
    debtId: string,
  ): Promise<PublicAttachment[]>;
  listDebtPaymentAttachments(
    ownerId: string,
    paymentId: string,
  ): Promise<PublicAttachment[]>;
  listExpenseAttachments(
    ownerId: string,
    expenseId: string,
  ): Promise<PublicAttachment[]>;
  listSubscriptionAttachments(
    ownerId: string,
    subscriptionId: string,
  ): Promise<PublicAttachment[]>;
  saveStorageConfig(
    ownerId: string,
    sessionId: string,
    input: AttachmentStorageConfigInput,
  ): Promise<PublicAttachmentStorageConfig>;
  testStorage(
    ownerId: string,
    input: AttachmentStorageConfigInput,
  ): Promise<{ message: string }>;
  uploadDebtAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }>;
  uploadDebtPaymentAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }>;
  uploadExpenseAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }>;
  uploadSubscriptionAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }>;
}

export interface MalwareScanResult {
  verdict: 'blocked' | 'clean' | 'not-configured';
}

export type MalwareScannerStatus = 'not-configured' | 'ready';

export interface MalwareScannerAdapter {
  readonly status: MalwareScannerStatus;
  scan(filePath: string): Promise<MalwareScanResult>;
}
