import type {
  DateFormat,
  NumberFormat,
  OwnerPreferences,
} from '@bizziemoney/shared';

export interface PreferenceChanges {
  dateFormat?: DateFormat;
  defaultCurrency?: string;
  firstDayOfWeek?: number;
  numberFormat?: NumberFormat;
  timeZone?: string;
}

export interface PreferenceRecord extends Omit<OwnerPreferences, 'updatedAt'> {
  updatedAt: Date;
}

export interface PreferenceServiceContract {
  get(ownerId: string): Promise<OwnerPreferences>;
  update(
    ownerId: string,
    sessionId: string,
    changes: PreferenceChanges,
  ): Promise<OwnerPreferences>;
}
