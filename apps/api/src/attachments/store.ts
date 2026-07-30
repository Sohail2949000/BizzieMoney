import { randomUUID } from 'node:crypto';

import { sql, type BizzieMoneyDatabase } from '@bizziemoney/database';
import type {
  PersistedAttachmentStorageConfig,
  StorageProvider,
} from '@bizziemoney/storage';

import type {
  AttachmentEntityType,
  AttachmentRecord,
  CreateAttachmentStoreInput,
} from './types';
import { attachmentObjectKeys } from './thumbnail-keys';

interface AttachmentRow {
  checksum_sha256: string;
  created_at: Date;
  display_name: string;
  id: string;
  mime_type: string;
  object_key: string;
  original_file_name: string;
  owner_id: string;
  size_bytes: string;
  storage_provider: StorageProvider;
  storage_root: string;
  updated_at: Date;
}

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    checksumSha256: row.checksum_sha256.trim(),
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    mimeType: row.mime_type,
    objectKey: row.object_key,
    originalFileName: row.original_file_name,
    ownerId: row.owner_id,
    sizeBytes: row.size_bytes,
    storageProvider: row.storage_provider,
    storageRoot: row.storage_root,
    updatedAt: row.updated_at,
  };
}

export interface AttachmentStorageConfigRecord extends PersistedAttachmentStorageConfig {
  updatedAt: Date | null;
}

export interface SaveAttachmentStorageConfigInput extends PersistedAttachmentStorageConfig {
  changedFields: string[];
  ownerId: string;
  s3StorageRoot: string | null;
  sessionId: string;
}

function mapStorageConfig(
  row: {
    active_provider: 'local' | 's3';
    s3_bucket: string | null;
    s3_credentials_ciphertext: string | null;
    s3_endpoint: string | null;
    s3_force_path_style: boolean;
    s3_prefix: string | null;
    s3_region: string | null;
    updated_at: Date;
  } | null,
): AttachmentStorageConfigRecord | null {
  return row
    ? {
        activeProvider: row.active_provider,
        s3Bucket: row.s3_bucket,
        s3CredentialsCiphertext: row.s3_credentials_ciphertext,
        s3Endpoint: row.s3_endpoint,
        s3ForcePathStyle: row.s3_force_path_style,
        s3Prefix: row.s3_prefix,
        s3Region: row.s3_region,
        updatedAt: row.updated_at,
      }
    : null;
}

export interface AttachmentStore {
  createAttachment(input: CreateAttachmentStoreInput): Promise<{
    attachmentId: string;
    mismatched: boolean;
    replayed: boolean;
  }>;
  deleteAttachment(input: {
    attachmentId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean>;
  enqueueOrphanCleanup(input: {
    objectKey: string;
    ownerId: string;
    storageProvider: StorageProvider;
    storageRoot: string;
  }): Promise<void>;
  getAttachment(
    ownerId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | null>;
  getStorageUsage(ownerId: string): Promise<{
    fileCount: number;
    totalSizeBytes: number;
  }>;
  getStorageConfig(
    ownerId: string,
  ): Promise<AttachmentStorageConfigRecord | null>;
  getStorageConfigForLocation(
    ownerId: string,
    provider: StorageProvider,
    rootIdentifier: string,
  ): Promise<AttachmentStorageConfigRecord | null>;
  getUploadRequest(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<{
    attachmentId: string;
    requestHash: string;
  } | null>;
  listEntityAttachments(
    ownerId: string,
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<AttachmentRecord[]>;
  saveStorageConfig(
    input: SaveAttachmentStorageConfigInput,
  ): Promise<AttachmentStorageConfigRecord>;
}

export class PostgresAttachmentStore implements AttachmentStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async getStorageConfig(
    ownerId: string,
  ): Promise<AttachmentStorageConfigRecord | null> {
    const row = await this.database
      .selectFrom('attachment_storage_configs')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .executeTakeFirst();
    return mapStorageConfig(row ?? null);
  }

  async getStorageConfigForLocation(
    ownerId: string,
    provider: StorageProvider,
    rootIdentifier: string,
  ): Promise<AttachmentStorageConfigRecord | null> {
    if (provider === 'local') return this.getStorageConfig(ownerId);
    const row = await this.database
      .selectFrom('attachment_storage_s3_profiles')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .where('storage_root', '=', rootIdentifier)
      .executeTakeFirst();
    return row
      ? {
          activeProvider: 's3',
          s3Bucket: row.bucket,
          s3CredentialsCiphertext: row.credentials_ciphertext,
          s3Endpoint: row.endpoint,
          s3ForcePathStyle: row.force_path_style,
          s3Prefix: row.prefix,
          s3Region: row.region,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async saveStorageConfig(
    input: SaveAttachmentStorageConfigInput,
  ): Promise<AttachmentStorageConfigRecord> {
    return this.database.transaction().execute(async (transaction) => {
      await transaction
        .selectFrom('app_users')
        .select('id')
        .where('id', '=', input.ownerId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (
        input.s3StorageRoot &&
        input.s3Bucket &&
        input.s3Region &&
        input.s3Prefix
      ) {
        await transaction
          .insertInto('attachment_storage_s3_profiles')
          .values({
            bucket: input.s3Bucket,
            credentials_ciphertext: input.s3CredentialsCiphertext,
            endpoint: input.s3Endpoint,
            force_path_style: input.s3ForcePathStyle,
            owner_id: input.ownerId,
            prefix: input.s3Prefix,
            region: input.s3Region,
            storage_root: input.s3StorageRoot,
          })
          .onConflict((conflict) =>
            conflict.columns(['owner_id', 'storage_root']).doUpdateSet({
              bucket: input.s3Bucket!,
              credentials_ciphertext: input.s3CredentialsCiphertext,
              endpoint: input.s3Endpoint,
              force_path_style: input.s3ForcePathStyle,
              prefix: input.s3Prefix!,
              region: input.s3Region!,
              updated_at: new Date(),
            }),
          )
          .executeTakeFirstOrThrow();
      }

      const row = await transaction
        .insertInto('attachment_storage_configs')
        .values({
          active_provider: input.activeProvider,
          owner_id: input.ownerId,
          s3_bucket: input.s3Bucket,
          s3_credentials_ciphertext: input.s3CredentialsCiphertext,
          s3_endpoint: input.s3Endpoint,
          s3_force_path_style: input.s3ForcePathStyle,
          s3_prefix: input.s3Prefix,
          s3_region: input.s3Region,
        })
        .onConflict((conflict) =>
          conflict.column('owner_id').doUpdateSet({
            active_provider: input.activeProvider,
            s3_bucket: input.s3Bucket,
            s3_credentials_ciphertext: input.s3CredentialsCiphertext,
            s3_endpoint: input.s3Endpoint,
            s3_force_path_style: input.s3ForcePathStyle,
            s3_prefix: input.s3Prefix,
            s3_region: input.s3Region,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'attachment.storage_settings_changed',
          id: randomUUID(),
          metadata: { changedFields: input.changedFields },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return mapStorageConfig(row)!;
    });
  }

  async getUploadRequest(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<{
    attachmentId: string;
    requestHash: string;
  } | null> {
    const row = await this.database
      .selectFrom('attachment_upload_requests')
      .select(['attachment_id', 'request_hash'])
      .where('owner_id', '=', ownerId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return row
      ? {
          attachmentId: row.attachment_id,
          requestHash: row.request_hash.trim(),
        }
      : null;
  }

  async createAttachment(input: CreateAttachmentStoreInput): Promise<{
    attachmentId: string;
    mismatched: boolean;
    replayed: boolean;
  }> {
    return this.database.transaction().execute(async (transaction) => {
      const request = await transaction
        .insertInto('attachment_upload_requests')
        .values({
          attachment_id: input.attachmentId,
          idempotency_key: input.idempotencyKey,
          owner_id: input.ownerId,
          request_hash: input.requestHash,
        })
        .onConflict((conflict) =>
          conflict.columns(['owner_id', 'idempotency_key']).doNothing(),
        )
        .returning('attachment_id')
        .executeTakeFirst();

      if (!request) {
        const existing = await transaction
          .selectFrom('attachment_upload_requests')
          .select(['attachment_id', 'request_hash'])
          .where('owner_id', '=', input.ownerId)
          .where('idempotency_key', '=', input.idempotencyKey)
          .executeTakeFirstOrThrow();
        return {
          attachmentId: existing.attachment_id,
          mismatched: existing.request_hash.trim() !== input.requestHash,
          replayed: existing.request_hash.trim() === input.requestHash,
        };
      }

      const entity =
        input.entityType === 'expense'
          ? await transaction
              .selectFrom('expenses')
              .select('id')
              .where('owner_id', '=', input.ownerId)
              .where('id', '=', input.entityId)
              .where('deleted_at', 'is', null)
              .executeTakeFirst()
          : input.entityType === 'subscription'
            ? await transaction
                .selectFrom('subscriptions')
                .select('id')
                .where('owner_id', '=', input.ownerId)
                .where('id', '=', input.entityId)
                .where('deleted_at', 'is', null)
                .executeTakeFirst()
            : input.entityType === 'debt'
              ? await transaction
                  .selectFrom('debts')
                  .select('id')
                  .where('owner_id', '=', input.ownerId)
                  .where('id', '=', input.entityId)
                  .where('deleted_at', 'is', null)
                  .executeTakeFirst()
              : await transaction
                  .selectFrom('debt_payments')
                  .innerJoin('debts', (join) =>
                    join
                      .onRef('debts.owner_id', '=', 'debt_payments.owner_id')
                      .onRef('debts.id', '=', 'debt_payments.debt_id'),
                  )
                  .select('debt_payments.id')
                  .where('debt_payments.owner_id', '=', input.ownerId)
                  .where('debt_payments.id', '=', input.entityId)
                  .where('debt_payments.deleted_at', 'is', null)
                  .where('debts.deleted_at', 'is', null)
                  .executeTakeFirst();
      if (!entity) throw new Error('ATTACHMENT_ENTITY_UNAVAILABLE');

      await transaction
        .insertInto('attachments')
        .values({
          checksum_sha256: input.checksumSha256,
          display_name: input.displayName,
          id: input.attachmentId,
          mime_type: input.mimeType,
          object_key: input.objectKey,
          original_file_name: input.originalFileName,
          owner_id: input.ownerId,
          size_bytes: input.sizeBytes,
          storage_provider: input.storageProvider,
          storage_root: input.storageRoot,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('entity_attachments')
        .values({
          attachment_id: input.attachmentId,
          entity_id: input.entityId,
          entity_type: input.entityType,
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'attachment.created',
          id: randomUUID(),
          metadata: {
            attachmentId: input.attachmentId,
            entityId: input.entityId,
            entityType: input.entityType,
          },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return {
        attachmentId: input.attachmentId,
        mismatched: false,
        replayed: false,
      };
    });
  }

  async listEntityAttachments(
    ownerId: string,
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<AttachmentRecord[]> {
    const entityAvailable =
      entityType === 'expense'
        ? await this.database
            .selectFrom('expenses')
            .select('id')
            .where('owner_id', '=', ownerId)
            .where('id', '=', entityId)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        : entityType === 'subscription'
          ? await this.database
              .selectFrom('subscriptions')
              .select('id')
              .where('owner_id', '=', ownerId)
              .where('id', '=', entityId)
              .where('deleted_at', 'is', null)
              .executeTakeFirst()
          : entityType === 'debt'
            ? await this.database
                .selectFrom('debts')
                .select('id')
                .where('owner_id', '=', ownerId)
                .where('id', '=', entityId)
                .where('deleted_at', 'is', null)
                .executeTakeFirst()
            : await this.database
                .selectFrom('debt_payments')
                .innerJoin('debts', (join) =>
                  join
                    .onRef('debts.owner_id', '=', 'debt_payments.owner_id')
                    .onRef('debts.id', '=', 'debt_payments.debt_id'),
                )
                .select('debt_payments.id')
                .where('debt_payments.owner_id', '=', ownerId)
                .where('debt_payments.id', '=', entityId)
                .where('debt_payments.deleted_at', 'is', null)
                .where('debts.deleted_at', 'is', null)
                .executeTakeFirst();
    if (!entityAvailable) return [];
    const result = await sql<AttachmentRow>`
      select
        a.id,
        a.owner_id,
        a.storage_provider,
        a.storage_root,
        a.object_key,
        a.original_file_name,
        a.display_name,
        a.mime_type,
        a.size_bytes::text as size_bytes,
        a.checksum_sha256,
        a.created_at,
        a.updated_at
      from attachments a
      inner join entity_attachments ea
        on ea.owner_id = a.owner_id
        and ea.attachment_id = a.id
      where a.owner_id = ${ownerId}::uuid
        and ea.entity_type = ${entityType}
        and ea.entity_id = ${entityId}::uuid
        and a.deleted_at is null
      order by a.created_at asc, a.id asc
    `.execute(this.database);
    return result.rows.map(mapAttachment);
  }

  async getAttachment(
    ownerId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | null> {
    const result = await sql<AttachmentRow>`
      select
        a.id,
        a.owner_id,
        a.storage_provider,
        a.storage_root,
        a.object_key,
        a.original_file_name,
        a.display_name,
        a.mime_type,
        a.size_bytes::text as size_bytes,
        a.checksum_sha256,
        a.created_at,
        a.updated_at
      from attachments a
      inner join entity_attachments ea
        on ea.owner_id = a.owner_id
        and ea.attachment_id = a.id
      where a.owner_id = ${ownerId}::uuid
        and a.id = ${attachmentId}::uuid
        and a.deleted_at is null
        and (
          (
            ea.entity_type = 'expense'
            and exists (
              select 1
              from expenses e
              where e.owner_id = ea.owner_id
                and e.id = ea.entity_id
                and e.deleted_at is null
            )
          )
          or
          (
            ea.entity_type = 'subscription'
            and exists (
              select 1
              from subscriptions s
              where s.owner_id = ea.owner_id
                and s.id = ea.entity_id
                and s.deleted_at is null
            )
          )
          or
          (
            ea.entity_type = 'debt'
            and exists (
              select 1
              from debts d
              where d.owner_id = ea.owner_id
                and d.id = ea.entity_id
                and d.deleted_at is null
            )
          )
          or
          (
            ea.entity_type = 'debt_payment'
            and exists (
              select 1
              from debt_payments p
              inner join debts d
                on d.owner_id = p.owner_id
                and d.id = p.debt_id
              where p.owner_id = ea.owner_id
                and p.id = ea.entity_id
                and p.deleted_at is null
                and d.deleted_at is null
            )
          )
        )
      limit 1
    `.execute(this.database);
    const row = result.rows[0];
    return row ? mapAttachment(row) : null;
  }

  async deleteAttachment(input: {
    attachmentId: string;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const attachment = await transaction
        .selectFrom('attachments')
        .select([
          'id',
          'mime_type',
          'object_key',
          'storage_provider',
          'storage_root',
        ])
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.attachmentId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!attachment) return false;

      await transaction
        .updateTable('attachments')
        .set({ deleted_at: input.now, updated_at: input.now })
        .where('owner_id', '=', input.ownerId)
        .where('id', '=', input.attachmentId)
        .executeTakeFirstOrThrow();
      await transaction
        .deleteFrom('entity_attachments')
        .where('owner_id', '=', input.ownerId)
        .where('attachment_id', '=', input.attachmentId)
        .execute();
      await transaction
        .insertInto('attachment_cleanup_jobs')
        .values(
          attachmentObjectKeys(attachment.object_key, attachment.mime_type).map(
            (objectKey) => ({
              attachment_id: attachment.id,
              id: randomUUID(),
              last_error_code: null,
              object_key: objectKey,
              owner_id: input.ownerId,
              storage_provider: attachment.storage_provider,
              storage_root: attachment.storage_root,
            }),
          ),
        )
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'attachment.deleted',
          id: randomUUID(),
          metadata: { attachmentId: input.attachmentId },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async enqueueOrphanCleanup(input: {
    objectKey: string;
    ownerId: string;
    storageProvider: StorageProvider;
    storageRoot: string;
  }): Promise<void> {
    await this.database
      .insertInto('attachment_cleanup_jobs')
      .values({
        attachment_id: null,
        id: randomUUID(),
        last_error_code: null,
        object_key: input.objectKey,
        owner_id: input.ownerId,
        storage_provider: input.storageProvider,
        storage_root: input.storageRoot,
      })
      .executeTakeFirstOrThrow();
  }

  async getStorageUsage(ownerId: string): Promise<{
    fileCount: number;
    totalSizeBytes: number;
  }> {
    const result = await sql<{ file_count: string; total_size_bytes: string }>`
      select
        count(*)::text as file_count,
        coalesce(sum(size_bytes), 0)::text as total_size_bytes
      from attachments
      where owner_id = ${ownerId}::uuid
        and deleted_at is null
    `.execute(this.database);
    const row = result.rows[0]!;
    return {
      fileCount: Number(row.file_count),
      totalSizeBytes: Number(row.total_size_bytes),
    };
  }
}
