import type { StorageProvider } from '@bizziemoney/storage';

export const FINANCIAL_PURGE_CONFIRMATION = 'DELETE ALL DATA';

export interface PortableRecord {
  data: Record<string, unknown>;
  type: string;
}

export interface PortableAttachmentSource {
  archivePath: string;
  checksumSha256: string;
  id: string;
  objectKey: string;
  sizeBytes: number;
  storageProvider: StorageProvider;
  storageRoot: string;
}

export interface PortableSnapshotWriters {
  writeAttachment(source: PortableAttachmentSource): Promise<void>;
  writeRecord(record: PortableRecord): Promise<void>;
}

export interface PortableSnapshotResult {
  applicationVersion: string;
  attachmentCount: number;
  recordCounts: Record<string, number>;
  schemaVersion: number;
}

export interface PortableExport {
  cleanup(): Promise<void>;
  fileName: string;
  filePath: string;
}

export interface FinancialPurgeCounts {
  attachmentFilesQueued: number;
  attachments: number;
  debtPayments: number;
  debts: number;
  expenses: number;
  subscriptionPayments: number;
  subscriptions: number;
  tags: number;
}

export interface FinancialPurgeResult extends FinancialPurgeCounts {
  completedAt: string;
  replayed: boolean;
}

export interface PurgeStoreInput {
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  requestHash: string;
  sessionId: string;
}

export interface DataStore {
  purgeFinancialData(input: PurgeStoreInput): Promise<FinancialPurgeResult>;
  writePortableSnapshot(
    ownerId: string,
    writers: PortableSnapshotWriters,
  ): Promise<PortableSnapshotResult>;
}

export interface DataServiceContract {
  createPortableExport(ownerId: string): Promise<PortableExport>;
  purgeFinancialData(
    sessionId: string,
    ownerId: string,
    idempotencyKey: string,
    confirmation: string,
  ): Promise<FinancialPurgeResult>;
}
