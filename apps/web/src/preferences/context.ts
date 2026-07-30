import { createContext, useContext } from 'react';

import type { OwnerPreferences } from '@bizziemoney/shared';

import type { PreferenceFormatters } from './format';

export interface PreferencesContextValue extends PreferenceFormatters {
  preferences: OwnerPreferences;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(
  null,
);

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences must be used inside PreferencesProvider.');
  }
  return value;
}
