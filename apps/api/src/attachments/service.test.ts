import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

import sharp from 'sharp';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  SecretBox,
  type AttachmentStorage,
  type PutFileInput,
  type StorageRegistry,
} from '@bizziemoney/storage';

import { AttachmentService } from './service.js';
import type { AttachmentStore } from './store.js';
import type { AttachmentRecord, MalwareScannerAdapter } from './types.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const expenseId = '00000000-0000-4000-8000-000000000002';
const attachmentId = '00000000-0000-4000-8000-000000000003';
const attachment: AttachmentRecord = {
  checksumSha256: 'a'.repeat(64),
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  displayName: 'notes.txt',
  id: attachmentId,
  mimeType: 'text/plain',
  objectKey: `attachments/${ownerId}/${attachmentId}/original`,
  originalFileName: 'notes.txt',
  ownerId,
  sizeBytes: '5',
  storageProvider: 'local',
  storageRoot: '/data/attachments',
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
};

function createStore(): {
  createAttachment: Mock<AttachmentStore['createAttachment']>;
  getAttachment: Mock<AttachmentStore['getAttachment']>;
  getStorageConfig: Mock<AttachmentStore['getStorageConfig']>;
  getUploadRequest: Mock<AttachmentStore['getUploadRequest']>;
  saveStorageConfig: Mock<AttachmentStore['saveStorageConfig']>;
  store: AttachmentStore;
} {
  const createAttachment = vi.fn<AttachmentStore['createAttachment']>(() =>
    Promise.resolve({
      attachmentId,
      mismatched: false,
      replayed: false,
    }),
  );
  const getUploadRequest = vi.fn<AttachmentStore['getUploadRequest']>(() =>
    Promise.resolve(null),
  );
  const getAttachment = vi.fn<AttachmentStore['getAttachment']>(() =>
    Promise.resolve(attachment),
  );
  const getStorageConfig = vi.fn<AttachmentStore['getStorageConfig']>(() =>
    Promise.resolve(null),
  );
  const saveStorageConfig = vi.fn<AttachmentStore['saveStorageConfig']>(
    (input) =>
      Promise.resolve({
        activeProvider: input.activeProvider,
        s3Bucket: input.s3Bucket,
        s3CredentialsCiphertext: input.s3CredentialsCiphertext,
        s3Endpoint: input.s3Endpoint,
        s3ForcePathStyle: input.s3ForcePathStyle,
        s3Prefix: input.s3Prefix,
        s3Region: input.s3Region,
        updatedAt: new Date('2026-07-29T00:00:00.000Z'),
      }),
  );
  return {
    createAttachment,
    getAttachment,
    getStorageConfig,
    getUploadRequest,
    saveStorageConfig,
    store: {
      createAttachment,
      deleteAttachment: vi.fn(() => Promise.resolve(true)),
      enqueueOrphanCleanup: vi.fn(),
      getAttachment,
      getStorageConfig,
      getStorageConfigForLocation: vi.fn(() => Promise.resolve(null)),
      getStorageUsage: vi.fn(() =>
        Promise.resolve({ fileCount: 1, totalSizeBytes: 5 }),
      ),
      getUploadRequest,
      listEntityAttachments: vi.fn(() => Promise.resolve([attachment])),
      saveStorageConfig,
    },
  };
}

function createStorage(): {
  openObject: Mock<AttachmentStorage['openObject']>;
  putFile: Mock<(input: PutFileInput) => Promise<void>>;
  registry: StorageRegistry;
} {
  const putFile = vi.fn<(input: PutFileInput) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const openObject = vi.fn<AttachmentStorage['openObject']>();
  const adapter = {
    deleteObject: vi.fn(() => Promise.resolve()),
    openObject,
    provider: 'local' as const,
    putFile,
    rootIdentifier: '/data/attachments',
    testConnection: vi.fn(() => Promise.resolve()),
  };
  return {
    openObject,
    putFile,
    registry: {
      active: adapter,
      availableProviders: () => ['local'],
      get: () => adapter,
    },
  };
}

describe('attachment service', () => {
  it('stores validated content under a generated key', async () => {
    const { createAttachment, store } = createStore();
    const storage = createStorage();
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
      undefined,
      () => new Date('2026-07-27T00:00:00.000Z'),
    );

    const result = await service.uploadExpenseAttachment({
      declaredMimeType: 'text/plain',
      entityId: expenseId,
      entityType: 'expense',
      fileName: 'notes.txt',
      idempotencyKey: '00000000-0000-4000-8000-000000000004',
      ownerId,
      sessionId: '00000000-0000-4000-8000-000000000005',
      stream: Readable.from(Buffer.from('hello')),
    });

    expect(result.replayed).toBe(false);
    const putInput = storage.putFile.mock.calls[0]?.[0];
    expect(putInput?.mimeType).toBe('text/plain');
    expect(putInput?.objectKey).toMatch(
      new RegExp(`^attachments/${ownerId}/[a-f0-9-]+/original$`),
    );
    expect(createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: expenseId,
        entityType: 'expense',
        ownerId,
      }),
    );
  });

  it('replays an idempotent upload without writing another object', async () => {
    const { getUploadRequest, store } = createStore();
    const checksumSha256 = createHash('sha256').update('hello').digest('hex');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          checksumSha256,
          displayName: 'notes.txt',
          entityId: expenseId,
          entityType: 'expense',
          mimeType: 'text/plain',
          sizeBytes: 5,
        }),
      )
      .digest('hex');
    getUploadRequest.mockResolvedValue({
      attachmentId,
      requestHash,
    });
    const storage = createStorage();
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
    );

    const request = service.uploadExpenseAttachment({
      declaredMimeType: 'text/plain',
      entityId: expenseId,
      entityType: 'expense',
      fileName: 'notes.txt',
      idempotencyKey: '00000000-0000-4000-8000-000000000004',
      ownerId,
      sessionId: '00000000-0000-4000-8000-000000000005',
      stream: Readable.from(Buffer.from('hello')),
    });

    await expect(request).resolves.toMatchObject({ replayed: true });
    expect(storage.putFile).not.toHaveBeenCalled();
  });

  it('blocks detected malware before writing an object', async () => {
    const { store } = createStore();
    const storage = createStorage();
    const scanner: MalwareScannerAdapter = {
      scan: vi.fn<MalwareScannerAdapter['scan']>(() =>
        Promise.resolve({ verdict: 'blocked' }),
      ),
      status: 'ready',
    };
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
      scanner,
    );

    await expect(
      service.uploadExpenseAttachment({
        declaredMimeType: 'text/plain',
        entityId: expenseId,
        entityType: 'expense',
        fileName: 'notes.txt',
        idempotencyKey: '00000000-0000-4000-8000-000000000004',
        ownerId,
        sessionId: '00000000-0000-4000-8000-000000000005',
        stream: Readable.from(Buffer.from('hello')),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_MALWARE_BLOCKED',
      statusCode: 422,
    });
    expect(storage.putFile).not.toHaveBeenCalled();
  });

  it('fails closed when the configured scanner is unavailable', async () => {
    const { store } = createStore();
    const storage = createStorage();
    const scanner: MalwareScannerAdapter = {
      scan: vi.fn<MalwareScannerAdapter['scan']>(() =>
        Promise.reject(new Error('connection refused')),
      ),
      status: 'ready',
    };
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
      scanner,
    );

    await expect(
      service.uploadExpenseAttachment({
        declaredMimeType: 'text/plain',
        entityId: expenseId,
        entityType: 'expense',
        fileName: 'notes.txt',
        idempotencyKey: '00000000-0000-4000-8000-000000000004',
        ownerId,
        sessionId: '00000000-0000-4000-8000-000000000005',
        stream: Readable.from(Buffer.from('hello')),
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_SCANNER_UNAVAILABLE',
      statusCode: 503,
    });
    expect(storage.putFile).not.toHaveBeenCalled();
  });

  it('regenerates a missing image thumbnail from the stored original', async () => {
    const imageBytes = await sharp({
      create: {
        background: { alpha: 1, b: 210, g: 120, r: 30 },
        channels: 4,
        height: 240,
        width: 360,
      },
    })
      .png()
      .toBuffer();
    const { getAttachment, store } = createStore();
    getAttachment.mockResolvedValue({
      ...attachment,
      displayName: 'receipt.png',
      mimeType: 'image/png',
      originalFileName: 'receipt.png',
      sizeBytes: String(imageBytes.length),
    });
    const storage = createStorage();
    storage.openObject
      .mockRejectedValueOnce(new Error('missing thumbnail'))
      .mockResolvedValueOnce({
        body: Readable.from(imageBytes),
        contentLength: imageBytes.length,
      })
      .mockResolvedValueOnce({
        body: Readable.from(Buffer.from('thumbnail')),
        contentLength: 9,
      });
    const service = new AttachmentService(
      store,
      storage.registry,
      1_048_576,
      new Set(['image/png']),
    );

    const result = await service.getThumbnail(ownerId, attachmentId);

    expect(result.object.contentLength).toBe(9);
    expect(storage.putFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/webp',
        objectKey: `attachments/${ownerId}/${attachmentId}/thumbnail.webp`,
      }),
    );
    expect(storage.openObject.mock.calls.map(([key]) => key)).toEqual([
      `attachments/${ownerId}/${attachmentId}/thumbnail.webp`,
      attachment.objectKey,
      `attachments/${ownerId}/${attachmentId}/thumbnail.webp`,
    ]);
  });

  it('encrypts attachment credentials and returns only their presence', async () => {
    const { saveStorageConfig, store } = createStore();
    const storage = createStorage();
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
      undefined,
      () => new Date('2026-07-29T00:00:00.000Z'),
      {
        baseConfig: {
          activeProvider: 'local',
          localPath: tmpdir(),
          s3: null,
        },
        secretBox: new SecretBox('s'.repeat(32)),
      },
    );

    const result = await service.saveStorageConfig(
      ownerId,
      '00000000-0000-4000-8000-000000000005',
      {
        provider: 'local',
        s3: {
          accessKeyId: 'r2-access',
          bucket: 'private-receipts',
          endpoint: 'https://account.r2.cloudflarestorage.com',
          forcePathStyle: false,
          prefix: 'bizziemoney',
          region: 'auto',
          secretAccessKey: 'r2-secret',
        },
      },
    );

    const saved = saveStorageConfig.mock.calls[0]?.[0];
    expect(saved?.s3CredentialsCiphertext).toBeTruthy();
    expect(saved?.s3CredentialsCiphertext).not.toContain('r2-secret');
    expect(saved?.changedFields).toContain('credentials');
    expect(result.s3).toMatchObject({
      bucket: 'private-receipts',
      hasCredentials: true,
    });
    expect(JSON.stringify(result)).not.toContain('r2-access');
    expect(JSON.stringify(result)).not.toContain('r2-secret');
  });

  it('rejects a partial S3 credential pair before testing storage', async () => {
    const { store } = createStore();
    const storage = createStorage();
    const service = new AttachmentService(
      store,
      storage.registry,
      1_024,
      new Set(['text/plain']),
      undefined,
      undefined,
      {
        baseConfig: {
          activeProvider: 'local',
          localPath: '/data/attachments',
          s3: null,
        },
        secretBox: new SecretBox('s'.repeat(32)),
      },
    );

    await expect(
      service.testStorage(ownerId, {
        provider: 's3',
        s3: {
          accessKeyId: 'only-one-key',
          bucket: 'private-receipts',
          endpoint: 'https://account.r2.cloudflarestorage.com',
          forcePathStyle: false,
          prefix: 'bizziemoney',
          region: 'auto',
        },
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_STORAGE_CREDENTIALS_INCOMPLETE',
      statusCode: 400,
    });
  });
});
