import type {
  DateFormat,
  NumberFormat,
  OwnerPreferences,
} from '@bizziemoney/shared';

import { apiRequest } from '../api/client';

export interface PreferenceChanges {
  dateFormat?: DateFormat;
  defaultCurrency?: string;
  firstDayOfWeek?: number;
  numberFormat?: NumberFormat;
  timeZone?: string;
}

export const preferenceQueryKey = ['settings', 'preferences'] as const;

export const preferenceApi = {
  get: () => apiRequest<OwnerPreferences>('/api/settings/preferences'),
  update: (changes: PreferenceChanges) =>
    apiRequest<OwnerPreferences>('/api/settings/preferences', {
      body: changes,
      method: 'PATCH',
    }),
};
