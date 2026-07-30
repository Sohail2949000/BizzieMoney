import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';

import { AuthStatusPage } from '../pages/AuthStatusPage';
import { preferenceApi, preferenceQueryKey } from './api';
import { PreferencesContext, type PreferencesContextValue } from './context';
import { createPreferenceFormatters } from './format';

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const preferencesQuery = useQuery({
    queryFn: preferenceApi.get,
    queryKey: preferenceQueryKey,
  });

  const value = useMemo<PreferencesContextValue | null>(() => {
    if (!preferencesQuery.data) return null;
    return {
      preferences: preferencesQuery.data,
      ...createPreferenceFormatters(preferencesQuery.data),
    };
  }, [preferencesQuery.data]);

  if (preferencesQuery.isError) {
    return (
      <AuthStatusPage
        kind="error"
        onRetry={() => {
          void preferencesQuery.refetch();
        }}
      />
    );
  }
  if (preferencesQuery.isPending || !value) {
    return <AuthStatusPage kind="loading" />;
  }

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
