import type { AttachmentStorageConfig } from './config';
import { LocalAttachmentStorage } from './local';
import { S3AttachmentStorage } from './s3';
import type {
  AttachmentStorage,
  StorageProvider,
  StorageRegistry,
} from './types';

export type AttachmentStorageConfigSource = (
  ownerId: string,
  location?: {
    provider: StorageProvider;
    rootIdentifier: string;
  },
) => Promise<AttachmentStorageConfig | null>;

class DefaultStorageRegistry implements StorageRegistry {
  readonly active: AttachmentStorage;
  private readonly adapters = new Map<StorageProvider, AttachmentStorage>();

  constructor(config: AttachmentStorageConfig) {
    const local = new LocalAttachmentStorage(config.localPath);
    this.adapters.set(local.provider, local);
    if (config.s3) {
      const s3 = new S3AttachmentStorage(config.s3);
      this.adapters.set(s3.provider, s3);
    }
    const active = this.adapters.get(config.activeProvider);
    if (!active) {
      throw new Error('ATTACHMENT_STORAGE_PROVIDER_UNAVAILABLE');
    }
    this.active = active;
  }

  availableProviders(): StorageProvider[] {
    return [...this.adapters.keys()];
  }

  get(provider: StorageProvider, rootIdentifier: string): AttachmentStorage {
    const adapter = this.adapters.get(provider);
    if (!adapter || adapter.rootIdentifier !== rootIdentifier) {
      throw new Error('ATTACHMENT_STORAGE_CONFIGURATION_MISMATCH');
    }
    return adapter;
  }
}

class ConfigurableStorageRegistry
  extends DefaultStorageRegistry
  implements StorageRegistry
{
  constructor(
    baseConfig: AttachmentStorageConfig,
    private readonly source: AttachmentStorageConfigSource,
  ) {
    super(baseConfig);
  }

  async activeFor(ownerId: string): Promise<AttachmentStorage> {
    const config = await this.source(ownerId);
    return config ? createStorageRegistry(config).active : this.active;
  }

  async availableProvidersFor(ownerId: string): Promise<StorageProvider[]> {
    const configured = await this.source(ownerId);
    return [
      ...new Set([
        ...this.availableProviders(),
        ...(configured
          ? createStorageRegistry(configured).availableProviders()
          : []),
      ]),
    ];
  }

  async getFor(
    ownerId: string,
    provider: StorageProvider,
    rootIdentifier: string,
  ): Promise<AttachmentStorage> {
    const configured = await this.source(ownerId, {
      provider,
      rootIdentifier,
    });
    if (configured) {
      try {
        return createStorageRegistry(configured).get(provider, rootIdentifier);
      } catch {
        // Files written before Settings configuration may still use the
        // deployment-managed adapter below.
      }
    }
    return this.get(provider, rootIdentifier);
  }
}

export function createStorageRegistry(
  config: AttachmentStorageConfig,
): StorageRegistry {
  return new DefaultStorageRegistry(config);
}

export function createConfigurableStorageRegistry(
  baseConfig: AttachmentStorageConfig,
  source: AttachmentStorageConfigSource,
): StorageRegistry {
  return new ConfigurableStorageRegistry(baseConfig, source);
}

export async function activeStorageFor(
  registry: StorageRegistry,
  ownerId: string,
): Promise<AttachmentStorage> {
  return registry.activeFor
    ? registry.activeFor(ownerId)
    : Promise.resolve(registry.active);
}

export async function availableStorageProvidersFor(
  registry: StorageRegistry,
  ownerId: string,
): Promise<StorageProvider[]> {
  return registry.availableProvidersFor
    ? registry.availableProvidersFor(ownerId)
    : Promise.resolve(registry.availableProviders());
}

export async function storageFor(
  registry: StorageRegistry,
  ownerId: string,
  provider: StorageProvider,
  rootIdentifier: string,
): Promise<AttachmentStorage> {
  return registry.getFor
    ? registry.getFor(ownerId, provider, rootIdentifier)
    : Promise.resolve(registry.get(provider, rootIdentifier));
}
