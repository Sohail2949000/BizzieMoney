import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  FileText,
  Paperclip,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { attachmentApi, type Attachment } from '../api/attachments';
import { ApiError } from '../api/client';

export type QueuedAttachmentStatus = 'failed' | 'queued' | 'uploading';

export interface QueuedAttachment {
  error: string | null;
  file: File;
  id: string;
  idempotencyKey: string;
  progress: number;
  status: QueuedAttachmentStatus;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function ExistingAttachment({
  attachment,
  onDelete,
}: {
  attachment: Attachment;
  onDelete: () => void;
}) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const showThumbnail = attachment.thumbnailAvailable && !thumbnailFailed;

  return (
    <li className="attachment-item">
      <span
        aria-hidden="true"
        className={`attachment-item__visual${
          showThumbnail ? ' attachment-item__visual--thumbnail' : ''
        }`}
      >
        {showThumbnail ? (
          <img
            alt=""
            height={44}
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
            src={attachmentApi.thumbnailUrl(attachment.id)}
            width={44}
          />
        ) : (
          <FileText size={17} />
        )}
      </span>
      <div>
        <strong>{attachment.displayName}</strong>
        <span>
          {formatBytes(attachment.sizeBytes)} · {attachment.mimeType}
        </span>
      </div>
      <div className="attachment-item__actions">
        {attachment.previewSupported ? (
          <a
            aria-label={`Preview ${attachment.displayName}`}
            href={attachmentApi.contentUrl(attachment.id, 'inline')}
            rel="noreferrer"
            target="_blank"
            title="Preview"
          >
            <Eye aria-hidden="true" size={16} />
          </a>
        ) : null}
        <a
          aria-label={`Download ${attachment.displayName}`}
          href={attachmentApi.contentUrl(attachment.id, 'attachment')}
          title="Download"
        >
          <Download aria-hidden="true" size={16} />
        </a>
        <button
          aria-label={`Delete ${attachment.displayName}`}
          className="attachment-item__danger"
          onClick={onDelete}
          title="Delete"
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} />
        </button>
      </div>
    </li>
  );
}

export function AttachmentPanel({
  entityId,
  entityType,
  onCancel,
  onQueueChange,
  onRetry,
  queued,
}: {
  entityId: string | null;
  entityType: 'debt' | 'debt_payment' | 'expense' | 'subscription';
  onCancel: (id: string) => void;
  onQueueChange: (queued: QueuedAttachment[]) => void;
  onRetry: (id: string) => void;
  queued: QueuedAttachment[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryFn: attachmentApi.getStatus,
    queryKey: ['attachment-storage'],
  });
  const attachmentsQuery = useQuery({
    enabled: Boolean(entityId),
    queryFn: () => {
      if (entityType === 'expense') {
        return attachmentApi.listForExpense(entityId!);
      }
      if (entityType === 'subscription') {
        return attachmentApi.listForSubscription(entityId!);
      }
      if (entityType === 'debt') {
        return attachmentApi.listForDebt(entityId!);
      }
      return attachmentApi.listForDebtPayment(entityId!);
    },
    queryKey: [`${entityType}-attachments`, entityId],
  });
  const deleteMutation = useMutation({
    mutationFn: attachmentApi.delete,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [`${entityType}-attachments`, entityId],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            entityType === 'expense'
              ? 'expenses'
              : entityType === 'subscription'
                ? 'subscriptions'
                : 'debts',
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: ['attachment-storage'],
        }),
      ]);
    },
  });

  const addFiles = (files: File[]) => {
    const status = statusQuery.data;
    if (!status) {
      setSelectionError('Attachment limits are still loading.');
      return;
    }
    const accepted: QueuedAttachment[] = [];
    for (const file of files) {
      if (file.size === 0) {
        setSelectionError(`${file.name} is empty.`);
        continue;
      }
      if (file.size > status.maxUploadSizeBytes) {
        setSelectionError(
          `${file.name} is larger than ${formatBytes(
            status.maxUploadSizeBytes,
          )}.`,
        );
        continue;
      }
      if (!status.allowedMimeTypes.includes(file.type)) {
        setSelectionError(`${file.name} is not an allowed file type.`);
        continue;
      }
      const duplicate = queued.some(
        (item) =>
          item.file.name === file.name &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified,
      );
      if (!duplicate) {
        accepted.push({
          error: null,
          file,
          id: globalThis.crypto.randomUUID(),
          idempotencyKey: globalThis.crypto.randomUUID(),
          progress: 0,
          status: 'queued',
        });
      }
    }
    if (accepted.length > 0) {
      setSelectionError(null);
      onQueueChange([...queued, ...accepted].slice(0, 10));
    }
  };

  const existing = attachmentsQuery.data ?? [];
  const error =
    deleteMutation.error instanceof ApiError
      ? deleteMutation.error.message
      : attachmentsQuery.isError
        ? 'Existing attachments could not be loaded.'
        : selectionError;

  return (
    <section
      aria-labelledby={`${entityType}-attachments-title`}
      className="attachment-panel"
    >
      <div className="attachment-panel__heading">
        <span>
          <Paperclip aria-hidden="true" size={17} />
          <strong id={`${entityType}-attachments-title`}>Attachments</strong>
        </span>
        <small>Up to 10 files per save</small>
      </div>

      <button
        className="attachment-dropzone"
        disabled={!statusQuery.data}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles([...event.dataTransfer.files]);
        }}
        type="button"
      >
        <UploadCloud aria-hidden="true" size={22} />
        <span>
          <strong>Drop files here</strong> or choose from this device
        </span>
        <small>
          {statusQuery.data
            ? `PDF, images, text, or CSV · ${formatBytes(
                statusQuery.data.maxUploadSizeBytes,
              )} each`
            : 'Loading secure upload limits…'}
        </small>
      </button>
      <input
        accept={statusQuery.data?.allowedMimeTypes?.join(',')}
        className="sr-only"
        multiple
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
        ref={inputRef}
        type="file"
      />

      {existing.length > 0 || queued.length > 0 ? (
        <ul className="attachment-list">
          {existing.map((attachment) => (
            <ExistingAttachment
              attachment={attachment}
              key={attachment.id}
              onDelete={() => {
                if (
                  globalThis.confirm(
                    `Delete “${attachment.displayName}”? The stored file will be removed.`,
                  )
                ) {
                  deleteMutation.mutate(attachment.id);
                }
              }}
            />
          ))}
          {queued.map((item) => (
            <li className="attachment-item" key={item.id}>
              <span aria-hidden="true" className="attachment-item__visual">
                <FileText size={17} />
              </span>
              <div>
                <strong>{item.file.name}</strong>
                <span>
                  {formatBytes(item.file.size)}
                  {item.status === 'uploading'
                    ? ` · Uploading ${item.progress}%`
                    : item.status === 'failed'
                      ? ` · ${item.error ?? 'Upload failed'}`
                      : ' · Ready to upload'}
                </span>
                {item.status === 'uploading' ? (
                  <progress max={100} value={item.progress}>
                    {item.progress}%
                  </progress>
                ) : null}
              </div>
              <div className="attachment-item__actions">
                {item.status === 'failed' ? (
                  <button
                    aria-label={`Retry ${item.file.name}`}
                    onClick={() => onRetry(item.id)}
                    title="Retry on save"
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={16} />
                  </button>
                ) : null}
                <button
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onCancel(item.id)}
                  title={
                    item.status === 'uploading' ? 'Cancel upload' : 'Remove'
                  }
                  type="button"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
