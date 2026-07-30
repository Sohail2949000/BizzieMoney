import { apiRequest, apiUrl, csrfToken } from './client';

export interface Attachment {
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
  availableProviders: Array<'local' | 's3'>;
  configuration: AttachmentStorageConfig;
  fileCount: number;
  malwareScanner: 'not-configured' | 'ready';
  maxUploadSizeBytes: number;
  provider: 'local' | 's3';
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
  provider: 'local' | 's3';
  s3: AttachmentStorageS3Input | null;
}

export interface AttachmentStorageConfig {
  provider: 'local' | 's3';
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

interface AttachmentErrorPayload {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

export class AttachmentUploadError extends Error {
  readonly code: string;

  constructor(message: string, code = 'ATTACHMENT_UPLOAD_FAILED') {
    super(message);
    this.name = 'AttachmentUploadError';
    this.code = code;
  }
}

export function uploadAttachment({
  entityId,
  entityType,
  file,
  idempotencyKey,
  onProgress,
  signal,
}: {
  entityId: string;
  entityType: 'debt-payments' | 'debts' | 'expenses' | 'subscriptions';
  file: File;
  idempotencyKey: string;
  onProgress: (progress: number) => void;
  signal: AbortSignal;
}): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('POST', apiUrl(`/api/${entityType}/${entityId}/attachments`));
    request.withCredentials = true;
    request.setRequestHeader('idempotency-key', idempotencyKey);
    const token = csrfToken();
    if (token) request.setRequestHeader('x-bm-csrf', token);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener('load', () => {
      signal.removeEventListener('abort', abort);
      const payload = (() => {
        try {
          return JSON.parse(request.responseText) as
            Attachment | AttachmentErrorPayload;
        } catch {
          return {};
        }
      })();
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(payload as Attachment);
        return;
      }
      const error = payload as AttachmentErrorPayload;
      reject(
        new AttachmentUploadError(
          error.error?.message ?? 'The file could not be uploaded.',
          error.error?.code,
        ),
      );
    });
    request.addEventListener('error', () => {
      signal.removeEventListener('abort', abort);
      reject(
        new AttachmentUploadError('The storage service could not be reached.'),
      );
    });
    request.addEventListener('abort', () => {
      signal.removeEventListener('abort', abort);
      reject(new AttachmentUploadError('Upload cancelled.', 'ABORTED'));
    });
    signal.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('file', file, file.name);
    request.send(form);
  });
}

export function uploadExpenseAttachment(
  input: Omit<
    Parameters<typeof uploadAttachment>[0],
    'entityId' | 'entityType'
  > & { expenseId: string },
): Promise<Attachment> {
  const { expenseId, ...upload } = input;
  return uploadAttachment({
    ...upload,
    entityId: expenseId,
    entityType: 'expenses',
  });
}

export const attachmentApi = {
  contentUrl: (attachmentId: string, disposition: 'attachment' | 'inline') =>
    apiUrl(
      `/api/attachments/${attachmentId}/content?disposition=${disposition}`,
    ),
  thumbnailUrl: (attachmentId: string) =>
    apiUrl(`/api/attachments/${attachmentId}/thumbnail`),
  delete: (attachmentId: string) =>
    apiRequest<void>(`/api/attachments/${attachmentId}`, {
      method: 'DELETE',
    }),
  getStatus: () =>
    apiRequest<AttachmentStorageStatus>('/api/attachment-storage'),
  saveStorage: (input: AttachmentStorageConfigInput) =>
    apiRequest<{ configuration: AttachmentStorageConfig }>(
      '/api/attachment-storage',
      {
        body: input,
        method: 'PATCH',
      },
    ),
  listForExpense: (expenseId: string) =>
    apiRequest<Attachment[]>(`/api/expenses/${expenseId}/attachments`),
  listForDebt: (debtId: string) =>
    apiRequest<Attachment[]>(`/api/debts/${debtId}/attachments`),
  listForDebtPayment: (paymentId: string) =>
    apiRequest<Attachment[]>(`/api/debt-payments/${paymentId}/attachments`),
  listForSubscription: (subscriptionId: string) =>
    apiRequest<Attachment[]>(
      `/api/subscriptions/${subscriptionId}/attachments`,
    ),
  testStorage: (input: AttachmentStorageConfigInput) =>
    apiRequest<{ message: string }>('/api/attachment-storage/test', {
      body: input,
      method: 'POST',
    }),
};
