import { createContext, useContext } from 'react';

import type { PublicOwner } from '../api/client';

export const authQueryKey = ['auth', 'bootstrap'] as const;

export interface AuthContextValue {
  owner: PublicOwner;
  sessionExpiresAt: string;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthBoundary.');
  }
  return value;
}
