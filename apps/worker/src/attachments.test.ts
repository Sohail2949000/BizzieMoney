import { describe, expect, it, vi, type Mock } from 'vitest';

import type { StorageRegistry } from '@bizziemoney/storage';

import {
  AttachmentCleanupProcessor,
  type AttachmentCleanupJob,
  type AttachmentCleanupStore,
  retryDelayMilliseconds,
} from './attachments';

const job: AttachmentCleanupJob = {
  attempts: 1,
  id: '019bbd3c-fae2-7bc1-968d-7f8504d47a3e',
  objectKey: 'attachments/owner/file/original',
  ownerId: '00000000-0000-4000-8000-000000000001',
  storageProvider: 'local',
  storageRoot: '/data/attachments',
};

function createStore(): {
  complete: Mock<AttachmentCleanupStore['complete']>;
  retry: Mock<AttachmentCleanupStore['retry']>;
  store: AttachmentCleanupStore;
} {
  const complete = vi
    .fn<AttachmentCleanupStore['complete']>()
    .mockResolvedValue(undefined);
  const retry = vi
    .fn<AttachmentCleanupStore['retry']>()
    .mockResolvedValue(undefined);
  return {
    complete,
    retry,
    store: {
      claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(null),
      complete,
      recoverStale: vi.fn().mockResolvedValue(0),
      retry,
    },
  };
}

function createStorage(deleteObject: () => Promise<void>): StorageRegistry {
  const adapter = {
    deleteObject,
    openObject: vi.fn(),
    provider: 'local' as const,
    putFile: vi.fn(),
    rootIdentifier: '/data/attachments',
    testConnection: vi.fn(),
  };
  return {
    active: adapter,
    availableProviders: () => ['local'],
    get: () => adapter,
  };
}

describe('attachment cleanup processor', () => {
  it('deletes an object and completes its job', async () => {
    const { complete, retry, store } = createStore();
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const processor = new AttachmentCleanupProcessor(
      store,
      createStorage(deleteObject),
      () => new Date('2026-07-27T00:00:00.000Z'),
    );

    await expect(processor.runBatch()).resolves.toBe(1);
    expect(deleteObject).toHaveBeenCalledWith(job.objectKey);
    expect(complete).toHaveBeenCalledWith(job.id, expect.any(Date));
    expect(retry).not.toHaveBeenCalled();
  });

  it('returns failed storage deletes to the retry queue', async () => {
    const { complete, retry, store } = createStore();
    const processor = new AttachmentCleanupProcessor(
      store,
      createStorage(() => Promise.reject(new Error('network down'))),
    );

    await expect(processor.runBatch()).resolves.toBe(1);
    expect(retry).toHaveBeenCalledWith(job, 'ERROR', expect.any(Date));
    expect(complete).not.toHaveBeenCalled();
  });

  it('caps exponential retry delays at one hour', () => {
    expect(retryDelayMilliseconds(1)).toBe(5_000);
    expect(retryDelayMilliseconds(20)).toBe(3_600_000);
  });
});
