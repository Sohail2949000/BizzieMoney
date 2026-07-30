import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

import type { StorageRegistry } from '@bizziemoney/storage';

import { AppError } from '../errors.js';
import { writePortableArchive } from './portable-archive.js';
import {
  FINANCIAL_PURGE_CONFIRMATION,
  type DataServiceContract,
  type DataStore,
  type FinancialPurgeResult,
  type PortableAttachmentSource,
  type PortableExport,
} from './types.js';

const readme = `BizzieMoney portable data export
==================================

records.ndjson contains one JSON object per line. Each line has a "type" and
a "data" object. Attachment binaries are stored beneath attachments/<id>/.
manifest.json describes this export and its record counts.

Security exclusions
-------------------
This archive deliberately excludes password hashes, sessions, CSRF and token
hashes, rate-limit state, audit/security logs, idempotency journals, backup
credentials, backup jobs, and backup artifacts. It contains private financial
data and should be stored securely.
`;

async function writeLine(
  stream: ReturnType<typeof createWriteStream>,
  value: unknown,
): Promise<void> {
  if (!stream.write(`${JSON.stringify(value)}\n`)) {
    await once(stream, 'drain');
  }
}

export class DataService implements DataServiceContract {
  constructor(
    private readonly store: DataStore,
    private readonly storage: StorageRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPortableExport(ownerId: string): Promise<PortableExport> {
    const directory = await mkdtemp(join(tmpdir(), 'bizziemoney-export-'));
    const recordsPath = join(directory, 'records.ndjson');
    const outputPath = join(directory, 'bizziemoney-full-export.tar.gz');
    const records = createWriteStream(recordsPath, {
      encoding: 'utf8',
      flags: 'wx',
    });
    const attachments: PortableAttachmentSource[] = [];
    try {
      const snapshot = await this.store.writePortableSnapshot(ownerId, {
        writeAttachment: (source) => {
          attachments.push(source);
          return Promise.resolve();
        },
        writeRecord: (record) => writeLine(records, record),
      });
      records.end();
      await finished(records);
      const exportedAt = this.now();
      const manifest = {
        applicationVersion: snapshot.applicationVersion,
        attachmentCount: snapshot.attachmentCount,
        exportedAt: exportedAt.toISOString(),
        format: 'bizziemoney-portable-export',
        formatVersion: 1,
        recordCounts: snapshot.recordCounts,
        schemaVersion: snapshot.schemaVersion,
        securityExclusions: [
          'authentication secrets and sessions',
          'audit and rate-limit records',
          'backup credentials, jobs, and artifacts',
          'request idempotency journals',
        ],
      };
      await writePortableArchive({
        attachments,
        manifest,
        ownerId,
        outputPath,
        readme,
        recordsPath,
        storage: this.storage,
      });
      const fileDate = exportedAt.toISOString().slice(0, 10);
      return {
        cleanup: () => rm(directory, { force: true, recursive: true }),
        fileName: `bizziemoney-full-export-${fileDate}.tar.gz`,
        filePath: outputPath,
      };
    } catch (error) {
      records.destroy();
      await rm(directory, { force: true, recursive: true }).catch(
        () => undefined,
      );
      if (error instanceof AppError) throw error;
      throw new AppError({
        code: 'DATA_EXPORT_FAILED',
        message:
          'BizzieMoney could not create a complete export. No partial archive was downloaded.',
        statusCode: 500,
      });
    }
  }

  async purgeFinancialData(
    sessionId: string,
    ownerId: string,
    idempotencyKey: string,
    confirmation: string,
  ): Promise<FinancialPurgeResult> {
    if (confirmation !== FINANCIAL_PURGE_CONFIRMATION) {
      throw new AppError({
        code: 'PURGE_CONFIRMATION_INVALID',
        message: `Type ${FINANCIAL_PURGE_CONFIRMATION} exactly to continue.`,
        statusCode: 400,
      });
    }
    const requestHash = createHash('sha256').update(confirmation).digest('hex');
    return this.store.purgeFinancialData({
      idempotencyKey,
      now: this.now(),
      ownerId,
      requestHash,
      sessionId,
    });
  }
}
