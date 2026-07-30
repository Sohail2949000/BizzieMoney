import { sql, type BizzieMoneyDatabase } from '@bizziemoney/database';
import {
  storageFor,
  type StorageProvider,
  type StorageRegistry,
} from '@bizziemoney/storage';

const MAX_ATTEMPTS = 10;
const STALE_LOCK_MILLISECONDS = 15 * 60_000;

export interface AttachmentCleanupJob {
  attempts: number;
  id: string;
  objectKey: string;
  ownerId: string;
  storageProvider: StorageProvider;
  storageRoot: string;
}

export interface AttachmentCleanupStore {
  claim(now: Date): Promise<AttachmentCleanupJob | null>;
  complete(jobId: string, now: Date): Promise<void>;
  recoverStale(now: Date): Promise<number>;
  retry(job: AttachmentCleanupJob, errorCode: string, now: Date): Promise<void>;
}

interface CleanupJobRow {
  attempts: number;
  id: string;
  object_key: string;
  owner_id: string;
  storage_provider: StorageProvider;
  storage_root: string;
}

function retryDelayMilliseconds(attempts: number): number {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

function errorCode(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.name || error.message
      : 'ATTACHMENT_CLEANUP_ERROR';
  return raw
    .toLocaleUpperCase('en-US')
    .replace(/[^A-Z0-9_]+/g, '_')
    .slice(0, 80);
}

export class PostgresAttachmentCleanupStore implements AttachmentCleanupStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async recoverStale(now: Date): Promise<number> {
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MILLISECONDS);
    const result = await this.database
      .updateTable('attachment_cleanup_jobs')
      .set({
        last_error_code: 'WORKER_LOCK_EXPIRED',
        locked_at: null,
        scheduled_at: now,
        status: 'pending',
        updated_at: now,
      })
      .where('status', '=', 'processing')
      .where('locked_at', '<', staleBefore)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async claim(now: Date): Promise<AttachmentCleanupJob | null> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await sql<CleanupJobRow>`
        with next_job as (
          select id
          from attachment_cleanup_jobs
          where status = 'pending'
            and scheduled_at <= ${now}
          order by scheduled_at asc, created_at asc, id asc
          for update skip locked
          limit 1
        )
        update attachment_cleanup_jobs as job
        set
          status = 'processing',
          attempts = job.attempts + 1,
          locked_at = ${now},
          updated_at = ${now}
        from next_job
        where job.id = next_job.id
        returning
          job.id,
          job.attempts,
          job.owner_id,
          job.storage_provider,
          job.storage_root,
          job.object_key
      `.execute(transaction);
      const row = result.rows[0];
      return row
        ? {
            attempts: row.attempts,
            id: row.id,
            objectKey: row.object_key,
            ownerId: row.owner_id,
            storageProvider: row.storage_provider,
            storageRoot: row.storage_root,
          }
        : null;
    });
  }

  async complete(jobId: string, now: Date): Promise<void> {
    await this.database
      .updateTable('attachment_cleanup_jobs')
      .set({
        completed_at: now,
        last_error_code: null,
        locked_at: null,
        status: 'completed',
        updated_at: now,
      })
      .where('id', '=', jobId)
      .where('status', '=', 'processing')
      .executeTakeFirst();
  }

  async retry(
    job: AttachmentCleanupJob,
    lastErrorCode: string,
    now: Date,
  ): Promise<void> {
    const failed = job.attempts >= MAX_ATTEMPTS;
    await this.database
      .updateTable('attachment_cleanup_jobs')
      .set({
        last_error_code: lastErrorCode,
        locked_at: null,
        scheduled_at: failed
          ? now
          : new Date(now.getTime() + retryDelayMilliseconds(job.attempts)),
        status: failed ? 'failed' : 'pending',
        updated_at: now,
      })
      .where('id', '=', job.id)
      .where('status', '=', 'processing')
      .executeTakeFirst();
  }
}

export class AttachmentCleanupProcessor {
  constructor(
    private readonly store: AttachmentCleanupStore,
    private readonly storage: StorageRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recoverStale(): Promise<number> {
    return this.store.recoverStale(this.now());
  }

  async runBatch(limit = 10): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const job = await this.store.claim(this.now());
      if (!job) break;
      try {
        const adapter = await storageFor(
          this.storage,
          job.ownerId,
          job.storageProvider,
          job.storageRoot,
        );
        await adapter.deleteObject(job.objectKey);
        await this.store.complete(job.id, this.now());
      } catch (error) {
        await this.store.retry(job, errorCode(error), this.now());
      }
      processed += 1;
    }
    return processed;
  }
}

export { retryDelayMilliseconds };
