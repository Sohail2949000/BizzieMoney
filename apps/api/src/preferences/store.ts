import { randomUUID } from 'node:crypto';

import type {
  BizzieMoneyDatabase,
  DatabaseSchema,
  Transaction,
} from '@bizziemoney/database';
import {
  nextBackupRun,
  type DateFormat,
  type NumberFormat,
} from '@bizziemoney/shared';

import type { PreferenceChanges, PreferenceRecord } from './types';

export interface PreferenceStore {
  get(ownerId: string): Promise<PreferenceRecord>;
  update(input: {
    changedFields: string[];
    changes: PreferenceChanges;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<PreferenceRecord>;
}

function toRecord(row: {
  date_format: string;
  default_currency: string;
  first_day_of_week: number;
  number_format: string;
  time_zone: string;
  updated_at: Date;
}): PreferenceRecord {
  return {
    dateFormat: row.date_format as DateFormat,
    defaultCurrency: row.default_currency.trim(),
    firstDayOfWeek: row.first_day_of_week,
    numberFormat: row.number_format as NumberFormat,
    timeZone: row.time_zone,
    updatedAt: row.updated_at,
  };
}

export class PostgresPreferenceStore implements PreferenceStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async get(ownerId: string): Promise<PreferenceRecord> {
    const row = await this.database
      .selectFrom('app_settings')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async update(input: {
    changedFields: string[];
    changes: PreferenceChanges;
    now: Date;
    ownerId: string;
    sessionId: string;
  }): Promise<PreferenceRecord> {
    return this.database.transaction().execute(async (transaction) => {
      const updates: {
        date_format?: DateFormat;
        default_currency?: string;
        first_day_of_week?: number;
        number_format?: NumberFormat;
        time_zone?: string;
        updated_at: Date;
      } = { updated_at: input.now };
      if (input.changes.dateFormat !== undefined) {
        updates.date_format = input.changes.dateFormat;
      }
      if (input.changes.defaultCurrency !== undefined) {
        updates.default_currency = input.changes.defaultCurrency;
      }
      if (input.changes.firstDayOfWeek !== undefined) {
        updates.first_day_of_week = input.changes.firstDayOfWeek;
      }
      if (input.changes.numberFormat !== undefined) {
        updates.number_format = input.changes.numberFormat;
      }
      if (input.changes.timeZone !== undefined) {
        updates.time_zone = input.changes.timeZone;
      }

      const row = await transaction
        .updateTable('app_settings')
        .set(updates)
        .where('owner_id', '=', input.ownerId)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.changes.timeZone !== undefined) {
        await this.rescheduleFutureBackup(
          transaction,
          input.ownerId,
          input.changes.timeZone,
          input.now,
        );
      }

      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: input.sessionId,
          event_type: 'settings.preferences_updated',
          id: randomUUID(),
          metadata: { changedFields: input.changedFields },
          owner_id: input.ownerId,
        })
        .executeTakeFirstOrThrow();

      return toRecord(row);
    });
  }

  private async rescheduleFutureBackup(
    transaction: Transaction<DatabaseSchema>,
    ownerId: string,
    timeZone: string,
    now: Date,
  ): Promise<void> {
    const config = await transaction
      .selectFrom('backup_configs')
      .select([
        'backup_time',
        'day_of_month',
        'day_of_week',
        'enabled',
        'frequency',
        'next_run_at',
      ])
      .where('owner_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirst();
    if (!config?.enabled || !config.next_run_at || config.next_run_at <= now) {
      return;
    }
    await transaction
      .updateTable('backup_configs')
      .set({
        next_run_at: nextBackupRun(
          {
            backupTime: config.backup_time.slice(0, 5),
            dayOfMonth: config.day_of_month,
            dayOfWeek: config.day_of_week,
            frequency: config.frequency,
          },
          now,
          timeZone,
        ),
        updated_at: now,
      })
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow();
  }
}
