import { describe, expect, it, vi } from 'vitest';

import {
  activeStorageFor,
  createConfigurableStorageRegistry,
  storageFor,
} from './registry';

describe('configurable attachment storage registry', () => {
  it('resolves the active profile and retained historical S3 locations', async () => {
    const source = vi.fn(
      (
        _ownerId: string,
        location?: { provider: 'local' | 's3'; rootIdentifier: string },
      ) =>
        Promise.resolve({
          activeProvider: 's3' as const,
          localPath: '/data/attachments',
          s3: {
            accessKeyId: 'key',
            bucket:
              location?.rootIdentifier === 'old-bucket/archive'
                ? 'old-bucket'
                : 'new-bucket',
            endpoint: 'https://example.r2.cloudflarestorage.com',
            forcePathStyle: false,
            prefix:
              location?.rootIdentifier === 'old-bucket/archive'
                ? 'archive'
                : 'current',
            region: 'auto',
            secretAccessKey: 'secret',
          },
        }),
    );
    const registry = createConfigurableStorageRegistry(
      {
        activeProvider: 'local',
        localPath: '/data/attachments',
        s3: null,
      },
      source,
    );

    const active = await activeStorageFor(registry, 'owner');
    const historical = await storageFor(
      registry,
      'owner',
      's3',
      'old-bucket/archive',
    );

    expect(active.provider).toBe('s3');
    expect(active.rootIdentifier).toBe('new-bucket/current');
    expect(historical.rootIdentifier).toBe('old-bucket/archive');
    expect(source).toHaveBeenLastCalledWith('owner', {
      provider: 's3',
      rootIdentifier: 'old-bucket/archive',
    });
  });

  it('falls back to the deployment adapter when no saved profile exists', async () => {
    const registry = createConfigurableStorageRegistry(
      {
        activeProvider: 'local',
        localPath: '/data/attachments',
        s3: null,
      },
      () => Promise.resolve(null),
    );

    const active = await activeStorageFor(registry, 'owner');
    const local = await storageFor(
      registry,
      'owner',
      'local',
      registry.active.rootIdentifier,
    );

    expect(active.provider).toBe('local');
    expect(local.rootIdentifier).toBe(registry.active.rootIdentifier);
  });
});
