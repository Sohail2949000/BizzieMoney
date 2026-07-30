import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { authApi, type BootstrapState } from '../api/client';
import { AuthStatusPage } from '../pages/AuthStatusPage';
import { LoginPage } from '../pages/LoginPage';
import { OwnerSetupPage } from '../pages/OwnerSetupPage';
import { PreferencesProvider } from '../preferences/PreferencesContext';
import { AuthContext, authQueryKey } from './auth';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const bootstrapQuery = useQuery({
    queryFn: authApi.bootstrap,
    queryKey: authQueryKey,
  });

  if (bootstrapQuery.isPending) {
    return <AuthStatusPage kind="loading" />;
  }
  if (bootstrapQuery.isError) {
    return (
      <AuthStatusPage
        kind="error"
        onRetry={() => {
          void bootstrapQuery.refetch();
        }}
      />
    );
  }

  const state: BootstrapState = bootstrapQuery.data;
  if (state.setupRequired) {
    return <OwnerSetupPage />;
  }
  if (!state.authenticated || !state.owner || !state.sessionExpiresAt) {
    return <LoginPage />;
  }

  return (
    <AuthContext.Provider
      value={{
        owner: state.owner,
        sessionExpiresAt: state.sessionExpiresAt,
      }}
    >
      <PreferencesProvider>{children}</PreferencesProvider>
    </AuthContext.Provider>
  );
}
