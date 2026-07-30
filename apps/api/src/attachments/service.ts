import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  activeStorageFor,
  attachmentStorageConfigFromPersisted,
  availableStorageProvidersFor,
  createStorageRegistry,
  sealAttachmentStorageCredentials,
  storageFor,
  type AttachmentStorageConfig,
  type SecretBox,
  type StorageRegistry,
} from '@bizziemoney/storage';

import { AppError } from '../errors.js';
import { DeferredMalwareScanner } from './scanner.js';
import type {
  AttachmentStorageConfigRecord,
  AttachmentStore,
  PostgresAttachmentStore,
} from './store.js';
import type {
  AttachmentContent,
  AttachmentRecord,
  AttachmentServiceContract,
  AttachmentStorageStatus,
  AttachmentStorageConfigInput,
  AttachmentUploadInput,
  MalwareScannerAdapter,
  PublicAttachment,
  PublicAttachmentStorageConfig,
} from './types.js';
import {
  supportsAttachmentThumbnail,
  THUMBNAIL_MIME_TYPE,
  thumbnailObjectKey,
} from './thumbnail-keys.js';
import { generateThumbnail } from './thumbnail.js';
import { stageAndValidateUpload, UploadValidationError } from './validation.js';

const PREVIEW_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

function toPublicAttachment(attachment: AttachmentRecord): PublicAttachment {
  return {
    checksumSha256: attachment.checksumSha256,
    createdAt: attachment.createdAt.toISOString(),
    displayName: attachment.displayName,
    id: attachment.id,
    mimeType: attachment.mimeType,
    previewSupported: PREVIEW_MIME_TYPES.has(attachment.mimeType),
    sizeBytes: Number(attachment.sizeBytes),
    thumbnailAvailable: supportsAttachmentThumbnail(attachment.mimeType),
    updatedAt: attachment.updatedAt.toISOString(),
  };
}

function uploadRequestHash(input: {
  checksumSha256: string;
  displayName: string;
  entityId: string;
  entityType: string;
  mimeType: string;
  sizeBytes: number;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class AttachmentService implements AttachmentServiceContract {
  constructor(
    private readonly store: AttachmentStore,
    private readonly storage: StorageRegistry,
    private readonly maxUploadSizeBytes: number,
    private readonly allowedMimeTypes: ReadonlySet<string>,
    private readonly scanner: MalwareScannerAdapter = new DeferredMalwareScanner(),
    private readonly now: () => Date = () => new Date(),
    private readonly settings?: {
      baseConfig: AttachmentStorageConfig;
      secretBox: SecretBox;
    },
  ) {}

  static fromPostgres(
    store: PostgresAttachmentStore,
    storage: StorageRegistry,
    maxUploadSizeBytes: number,
    allowedMimeTypes: ReadonlySet<string>,
    settings?: {
      baseConfig: AttachmentStorageConfig;
      secretBox: SecretBox;
    },
    scanner: MalwareScannerAdapter = new DeferredMalwareScanner(),
  ): AttachmentService {
    return new AttachmentService(
      store,
      storage,
      maxUploadSizeBytes,
      allowedMimeTypes,
      scanner,
      undefined,
      settings,
    );
  }

  async uploadExpenseAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }> {
    return this.uploadAttachment({ ...input, entityType: 'expense' });
  }

  async uploadSubscriptionAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }> {
    return this.uploadAttachment({ ...input, entityType: 'subscription' });
  }

  async uploadDebtAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }> {
    return this.uploadAttachment({ ...input, entityType: 'debt' });
  }

  async uploadDebtPaymentAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }> {
    return this.uploadAttachment({ ...input, entityType: 'debt_payment' });
  }

  private async uploadAttachment(
    input: AttachmentUploadInput,
  ): Promise<{ attachment: PublicAttachment; replayed: boolean }> {
    let staged;
    try {
      staged = await stageAndValidateUpload({
        allowedMimeTypes: this.allowedMimeTypes,
        declaredMimeType: input.declaredMimeType,
        fileName: input.fileName,
        maxBytes: this.maxUploadSizeBytes,
        stream: input.stream,
      });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        throw new AppError({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        });
      }
      throw error;
    }

    try {
      const requestHash = uploadRequestHash({
        checksumSha256: staged.checksumSha256,
        displayName: staged.displayName,
        entityId: input.entityId,
        entityType: input.entityType,
        mimeType: staged.mimeType,
        sizeBytes: staged.sizeBytes,
      });
      const existingRequest = await this.store.getUploadRequest(
        input.ownerId,
        input.idempotencyKey,
      );
      if (existingRequest) {
        if (existingRequest.requestHash !== requestHash) {
          throw this.idempotencyConflict();
        }
        return {
          attachment: await this.requireAttachment(
            input.ownerId,
            existingRequest.attachmentId,
          ),
          replayed: true,
        };
      }

      try {
        const scan = await this.scanner.scan(staged.filePath);
        if (scan.verdict === 'blocked') {
          throw new AppError({
            code: 'ATTACHMENT_MALWARE_BLOCKED',
            message: 'That file did not pass the installation safety check.',
            statusCode: 422,
          });
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError({
          code: 'ATTACHMENT_SCANNER_UNAVAILABLE',
          message:
            'The file safety scanner is temporarily unavailable. Try again later.',
          statusCode: 503,
        });
      }

      const attachmentId = randomUUID();
      const objectKey = `attachments/${input.ownerId}/${attachmentId}/original`;
      const thumbnailKey = supportsAttachmentThumbnail(staged.mimeType)
        ? thumbnailObjectKey(objectKey)
        : null;
      const adapter = await activeStorageFor(this.storage, input.ownerId);
      let thumbnail: Awaited<ReturnType<typeof generateThumbnail>> | null =
        null;
      try {
        if (thumbnailKey) {
          thumbnail = await generateThumbnail(staged.filePath);
        }
        await adapter.putFile({
          checksumSha256: staged.checksumSha256,
          filePath: staged.filePath,
          mimeType: staged.mimeType,
          objectKey,
        });
        if (thumbnailKey && thumbnail) {
          await adapter.putFile({
            checksumSha256: thumbnail.checksumSha256,
            filePath: thumbnail.filePath,
            mimeType: THUMBNAIL_MIME_TYPE,
            objectKey: thumbnailKey,
          });
        }
      } catch (error) {
        await Promise.all([
          this.cleanupUncommittedObject(input.ownerId, adapter, objectKey),
          ...(thumbnailKey
            ? [
                this.cleanupUncommittedObject(
                  input.ownerId,
                  adapter,
                  thumbnailKey,
                ),
              ]
            : []),
        ]);
        if (thumbnailKey && !thumbnail) {
          throw new AppError({
            code: 'ATTACHMENT_IMAGE_INVALID',
            message: 'That image could not be prepared for preview.',
            statusCode: 422,
          });
        }
        throw error;
      }

      let result;
      try {
        result = await this.store.createAttachment({
          attachmentId,
          checksumSha256: staged.checksumSha256,
          displayName: staged.displayName,
          entityId: input.entityId,
          entityType: input.entityType,
          idempotencyKey: input.idempotencyKey,
          mimeType: staged.mimeType,
          now: this.now(),
          objectKey,
          originalFileName: staged.originalFileName,
          ownerId: input.ownerId,
          requestHash,
          sessionId: input.sessionId,
          sizeBytes: staged.sizeBytes,
          storageProvider: adapter.provider,
          storageRoot: adapter.rootIdentifier,
        });
      } catch (error) {
        await this.cleanupUncommittedObjects(
          input.ownerId,
          adapter,
          objectKey,
          thumbnailKey,
        );
        if (
          error instanceof Error &&
          error.message === 'ATTACHMENT_ENTITY_UNAVAILABLE'
        ) {
          throw this.entityUnavailable();
        }
        throw error;
      }

      if (result.mismatched || result.replayed) {
        await this.cleanupUncommittedObjects(
          input.ownerId,
          adapter,
          objectKey,
          thumbnailKey,
        );
      }
      if (result.mismatched) throw this.idempotencyConflict();
      return {
        attachment: await this.requireAttachment(
          input.ownerId,
          result.attachmentId,
        ),
        replayed: result.replayed,
      };
    } finally {
      await staged.cleanup();
    }
  }

  async listExpenseAttachments(
    ownerId: string,
    expenseId: string,
  ): Promise<PublicAttachment[]> {
    return this.listEntityAttachments(ownerId, 'expense', expenseId);
  }

  async listSubscriptionAttachments(
    ownerId: string,
    subscriptionId: string,
  ): Promise<PublicAttachment[]> {
    return this.listEntityAttachments(ownerId, 'subscription', subscriptionId);
  }

  async listDebtAttachments(
    ownerId: string,
    debtId: string,
  ): Promise<PublicAttachment[]> {
    return this.listEntityAttachments(ownerId, 'debt', debtId);
  }

  async listDebtPaymentAttachments(
    ownerId: string,
    paymentId: string,
  ): Promise<PublicAttachment[]> {
    return this.listEntityAttachments(ownerId, 'debt_payment', paymentId);
  }

  private async listEntityAttachments(
    ownerId: string,
    entityType: AttachmentUploadInput['entityType'],
    entityId: string,
  ): Promise<PublicAttachment[]> {
    return (
      await this.store.listEntityAttachments(ownerId, entityType, entityId)
    ).map((attachment) => toPublicAttachment(attachment));
  }

  async getContent(
    ownerId: string,
    attachmentId: string,
  ): Promise<AttachmentContent> {
    const attachment = await this.store.getAttachment(ownerId, attachmentId);
    if (!attachment) throw this.attachmentUnavailable();
    try {
      const adapter = await storageFor(
        this.storage,
        ownerId,
        attachment.storageProvider,
        attachment.storageRoot,
      );
      return {
        attachment,
        object: await adapter.openObject(attachment.objectKey),
      };
    } catch {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
        message: 'The file could not be opened from storage.',
        statusCode: 503,
      });
    }
  }

  async getThumbnail(
    ownerId: string,
    attachmentId: string,
  ): Promise<AttachmentContent> {
    const attachment = await this.store.getAttachment(ownerId, attachmentId);
    if (!attachment || !supportsAttachmentThumbnail(attachment.mimeType)) {
      throw new AppError({
        code: 'ATTACHMENT_THUMBNAIL_NOT_AVAILABLE',
        message: 'A thumbnail is not available for that attachment.',
        statusCode: 404,
      });
    }
    const adapter = await storageFor(
      this.storage,
      ownerId,
      attachment.storageProvider,
      attachment.storageRoot,
    );
    const objectKey = thumbnailObjectKey(attachment.objectKey);
    try {
      return {
        attachment,
        object: await adapter.openObject(objectKey),
      };
    } catch {
      await this.regenerateThumbnail(attachment, adapter, objectKey);
      try {
        return {
          attachment,
          object: await adapter.openObject(objectKey),
        };
      } catch {
        throw this.thumbnailUnavailable();
      }
    }
  }

  async deleteAttachment(
    ownerId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<void> {
    const deleted = await this.store.deleteAttachment({
      attachmentId,
      now: this.now(),
      ownerId,
      sessionId,
    });
    if (!deleted) throw this.attachmentUnavailable();
  }

  async getStorageStatus(ownerId: string): Promise<AttachmentStorageStatus> {
    const [usage, active, availableProviders, configuration] =
      await Promise.all([
        this.store.getStorageUsage(ownerId),
        activeStorageFor(this.storage, ownerId),
        availableStorageProvidersFor(this.storage, ownerId),
        this.getPublicStorageConfig(ownerId),
      ]);
    return {
      allowedMimeTypes: [...this.allowedMimeTypes],
      availableProviders,
      configuration,
      ...usage,
      malwareScanner: this.scanner.status,
      maxUploadSizeBytes: this.maxUploadSizeBytes,
      provider: active.provider,
      providerLabel:
        active.provider === 'local'
          ? 'Local host folder'
          : 'S3-compatible storage',
    };
  }

  async saveStorageConfig(
    ownerId: string,
    sessionId: string,
    input: AttachmentStorageConfigInput,
  ): Promise<PublicAttachmentStorageConfig> {
    const prepared = await this.prepareStorageConfig(ownerId, input);
    await this.verifyStorageConnection(prepared.config);
    const currentPublic = this.toPublicStorageConfig(
      prepared.currentConfig,
      prepared.currentRecord,
    );
    const nextPublic = this.toPublicStorageConfig(prepared.config, null);
    const changedFields = [
      ...(currentPublic.provider === nextPublic.provider ? [] : ['provider']),
      ...(currentPublic.s3?.bucket === nextPublic.s3?.bucket ? [] : ['bucket']),
      ...(currentPublic.s3?.endpoint === nextPublic.s3?.endpoint
        ? []
        : ['endpoint']),
      ...(currentPublic.s3?.forcePathStyle === nextPublic.s3?.forcePathStyle
        ? []
        : ['forcePathStyle']),
      ...(currentPublic.s3?.prefix === nextPublic.s3?.prefix ? [] : ['prefix']),
      ...(currentPublic.s3?.region === nextPublic.s3?.region ? [] : ['region']),
      ...(prepared.credentialsChanged ? ['credentials'] : []),
    ];
    const s3Adapter = prepared.config.s3
      ? createStorageRegistry({
          ...prepared.config,
          activeProvider: 's3',
        }).active
      : null;
    const saved = await this.store.saveStorageConfig({
      activeProvider: prepared.config.activeProvider,
      changedFields,
      ownerId,
      s3Bucket: prepared.config.s3?.bucket ?? null,
      s3CredentialsCiphertext: prepared.credentialsCiphertext,
      s3Endpoint: prepared.config.s3?.endpoint ?? null,
      s3ForcePathStyle: prepared.config.s3?.forcePathStyle ?? false,
      s3Prefix: prepared.config.s3?.prefix ?? null,
      s3Region: prepared.config.s3?.region ?? null,
      s3StorageRoot: s3Adapter?.rootIdentifier ?? null,
      sessionId,
    });
    return this.toPublicStorageConfig(prepared.config, saved);
  }

  async testStorage(
    ownerId: string,
    input: AttachmentStorageConfigInput,
  ): Promise<{ message: string }> {
    const prepared = await this.prepareStorageConfig(ownerId, input);
    await this.verifyStorageConnection(prepared.config);
    return {
      message:
        input.provider === 'local'
          ? 'The local attachment folder is ready.'
          : 'The S3-compatible attachment destination is reachable.',
    };
  }

  private async verifyStorageConnection(
    config: AttachmentStorageConfig,
  ): Promise<void> {
    try {
      await createStorageRegistry(config).active.testConnection();
    } catch {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_TEST_FAILED',
        message: 'The storage connection could not be verified.',
        statusCode: 503,
      });
    }
  }

  private async getPublicStorageConfig(
    ownerId: string,
  ): Promise<PublicAttachmentStorageConfig> {
    const { baseConfig } = this.requireStorageSettings();
    const record = await this.store.getStorageConfig(ownerId);
    const config = this.resolveStorageConfig(record) ?? baseConfig;
    return this.toPublicStorageConfig(config, record);
  }

  private async prepareStorageConfig(
    ownerId: string,
    input: AttachmentStorageConfigInput,
  ): Promise<{
    config: AttachmentStorageConfig;
    credentialsChanged: boolean;
    credentialsCiphertext: string | null;
    currentConfig: AttachmentStorageConfig;
    currentRecord: AttachmentStorageConfigRecord | null;
  }> {
    const { baseConfig, secretBox } = this.requireStorageSettings();
    const currentRecord = await this.store.getStorageConfig(ownerId);
    const currentConfig =
      this.resolveStorageConfig(currentRecord) ?? baseConfig;
    const suppliedAccessKey = input.s3?.accessKeyId?.trim();
    const suppliedSecretKey = input.s3?.secretAccessKey?.trim();
    if (Boolean(suppliedAccessKey) !== Boolean(suppliedSecretKey)) {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_CREDENTIALS_INCOMPLETE',
        message: 'Enter both the S3 access key and secret key.',
        statusCode: 400,
      });
    }
    if (
      input.s3?.removeCredentials &&
      (suppliedAccessKey || suppliedSecretKey)
    ) {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_CREDENTIALS_CONFLICT',
        message: 'Remove the saved keys or enter replacements, not both.',
        statusCode: 400,
      });
    }

    const retainedS3 = input.s3
      ? null
      : currentConfig.s3
        ? {
            bucket: currentConfig.s3.bucket,
            endpoint: currentConfig.s3.endpoint ?? null,
            forcePathStyle: currentConfig.s3.forcePathStyle,
            prefix: currentConfig.s3.prefix,
            region: currentConfig.s3.region,
          }
        : null;
    const selectedS3 = input.s3 ?? retainedS3;
    if (input.provider === 's3' && !selectedS3) {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_CONFIGURATION_INCOMPLETE',
        message: 'Enter the S3-compatible storage details.',
        statusCode: 400,
      });
    }

    const currentCredentials = currentConfig.s3?.accessKeyId
      ? {
          accessKeyId: currentConfig.s3.accessKeyId,
          secretAccessKey: currentConfig.s3.secretAccessKey!,
        }
      : null;
    const credentials =
      suppliedAccessKey && suppliedSecretKey
        ? {
            accessKeyId: suppliedAccessKey,
            secretAccessKey: suppliedSecretKey,
          }
        : input.s3?.removeCredentials
          ? null
          : currentCredentials;
    const credentialsCiphertext =
      suppliedAccessKey && suppliedSecretKey
        ? sealAttachmentStorageCredentials(secretBox, {
            accessKeyId: suppliedAccessKey,
            secretAccessKey: suppliedSecretKey,
          })
        : input.s3?.removeCredentials
          ? null
          : (currentRecord?.s3CredentialsCiphertext ??
            (currentCredentials
              ? sealAttachmentStorageCredentials(secretBox, currentCredentials)
              : null));
    const s3 = selectedS3
      ? {
          accessKeyId: credentials?.accessKeyId,
          bucket: selectedS3.bucket,
          endpoint: selectedS3.endpoint ?? undefined,
          forcePathStyle: selectedS3.forcePathStyle,
          prefix: selectedS3.prefix,
          region: selectedS3.region,
          secretAccessKey: credentials?.secretAccessKey,
        }
      : null;
    return {
      config: {
        activeProvider: input.provider,
        localPath: baseConfig.localPath,
        s3,
      },
      credentialsChanged: Boolean(
        suppliedAccessKey || suppliedSecretKey || input.s3?.removeCredentials,
      ),
      credentialsCiphertext,
      currentConfig,
      currentRecord,
    };
  }

  private resolveStorageConfig(
    record: AttachmentStorageConfigRecord | null,
  ): AttachmentStorageConfig | null {
    const { baseConfig, secretBox } = this.requireStorageSettings();
    try {
      return attachmentStorageConfigFromPersisted(
        baseConfig,
        record,
        secretBox,
      );
    } catch {
      throw new AppError({
        code: 'ATTACHMENT_STORAGE_CREDENTIALS_UNAVAILABLE',
        message:
          'The saved storage credentials could not be opened. Save them again.',
        statusCode: 409,
      });
    }
  }

  private toPublicStorageConfig(
    config: AttachmentStorageConfig,
    record: AttachmentStorageConfigRecord | null,
  ): PublicAttachmentStorageConfig {
    return {
      provider: config.activeProvider,
      s3: config.s3
        ? {
            bucket: config.s3.bucket,
            endpoint: config.s3.endpoint ?? null,
            forcePathStyle: config.s3.forcePathStyle,
            hasCredentials: Boolean(
              config.s3.accessKeyId && config.s3.secretAccessKey,
            ),
            prefix: config.s3.prefix,
            region: config.s3.region,
          }
        : null,
      source: record ? 'settings' : 'environment',
      updatedAt: record?.updatedAt?.toISOString() ?? null,
    };
  }

  private requireStorageSettings(): {
    baseConfig: AttachmentStorageConfig;
    secretBox: SecretBox;
  } {
    if (!this.settings) {
      throw new Error('ATTACHMENT_STORAGE_SETTINGS_UNAVAILABLE');
    }
    return this.settings;
  }

  private async requireAttachment(
    ownerId: string,
    attachmentId: string,
  ): Promise<PublicAttachment> {
    const attachment = await this.store.getAttachment(ownerId, attachmentId);
    if (!attachment) throw this.attachmentUnavailable();
    return toPublicAttachment(attachment);
  }

  private async cleanupUncommittedObject(
    ownerId: string,
    adapter: StorageRegistry['active'],
    objectKey: string,
  ): Promise<void> {
    try {
      await adapter.deleteObject(objectKey);
    } catch {
      await this.store.enqueueOrphanCleanup({
        objectKey,
        ownerId,
        storageProvider: adapter.provider,
        storageRoot: adapter.rootIdentifier,
      });
    }
  }

  private async cleanupUncommittedObjects(
    ownerId: string,
    adapter: StorageRegistry['active'],
    objectKey: string,
    thumbnailKey: string | null,
  ): Promise<void> {
    await Promise.all([
      this.cleanupUncommittedObject(ownerId, adapter, objectKey),
      ...(thumbnailKey
        ? [this.cleanupUncommittedObject(ownerId, adapter, thumbnailKey)]
        : []),
    ]);
  }

  private async regenerateThumbnail(
    attachment: AttachmentRecord,
    adapter: StorageRegistry['active'],
    objectKey: string,
  ): Promise<void> {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'bizziemoney-thumbnail-'),
    );
    const sourceFilePath = join(temporaryRoot, 'original');
    try {
      const original = await adapter.openObject(attachment.objectKey);
      await pipeline(
        original.body,
        createWriteStream(sourceFilePath, { flags: 'wx', mode: 0o600 }),
      );
      const thumbnail = await generateThumbnail(sourceFilePath);
      await adapter.putFile({
        checksumSha256: thumbnail.checksumSha256,
        filePath: thumbnail.filePath,
        mimeType: THUMBNAIL_MIME_TYPE,
        objectKey,
      });
    } catch {
      throw this.thumbnailUnavailable();
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }

  private attachmentUnavailable(): AppError {
    return new AppError({
      code: 'ATTACHMENT_NOT_FOUND',
      message: 'That attachment is no longer available.',
      statusCode: 404,
    });
  }

  private entityUnavailable(): AppError {
    return new AppError({
      code: 'ATTACHMENT_ENTITY_NOT_FOUND',
      message: 'Save this record before attaching a file.',
      statusCode: 404,
    });
  }

  private idempotencyConflict(): AppError {
    return new AppError({
      code: 'ATTACHMENT_IDEMPOTENCY_KEY_REUSED',
      message: 'Retry this file with a fresh upload request.',
      statusCode: 409,
    });
  }

  private thumbnailUnavailable(): AppError {
    return new AppError({
      code: 'ATTACHMENT_THUMBNAIL_UNAVAILABLE',
      message: 'The thumbnail could not be prepared from storage.',
      statusCode: 503,
    });
  }
}
