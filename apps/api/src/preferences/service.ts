import type { OwnerPreferences } from '@bizziemoney/shared';

import type { PreferenceStore } from './store';
import type {
  PreferenceChanges,
  PreferenceRecord,
  PreferenceServiceContract,
} from './types';

function toPublic(record: PreferenceRecord): OwnerPreferences {
  return {
    ...record,
    updatedAt: record.updatedAt.toISOString(),
  };
}

const fieldNames = [
  'dateFormat',
  'defaultCurrency',
  'firstDayOfWeek',
  'numberFormat',
  'timeZone',
] as const;

export class PreferenceService implements PreferenceServiceContract {
  constructor(
    private readonly store: PreferenceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(ownerId: string): Promise<OwnerPreferences> {
    return toPublic(await this.store.get(ownerId));
  }

  async update(
    ownerId: string,
    sessionId: string,
    changes: PreferenceChanges,
  ): Promise<OwnerPreferences> {
    const current = await this.store.get(ownerId);
    const changedFields = fieldNames.filter(
      (field) =>
        changes[field] !== undefined && changes[field] !== current[field],
    );
    if (changedFields.length === 0) return toPublic(current);
    return toPublic(
      await this.store.update({
        changedFields,
        changes,
        now: this.now(),
        ownerId,
        sessionId,
      }),
    );
  }
}
