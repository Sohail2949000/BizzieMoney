import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { authApi } from '../api/client';
import { authQueryKey, useAuth } from '../auth/auth';

export function OwnerMenu() {
  const { owner } = useAuth();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });

  return (
    <details className="owner-menu">
      <summary className="owner">
        <span aria-hidden="true" className="owner__avatar">
          <UserRound size={17} strokeWidth={1.7} />
        </span>
        <span className="owner__copy">
          <strong>{owner.displayName}</strong>
          <span>{owner.email}</span>
        </span>
      </summary>
      <div className="owner-menu__popover">
        <Link to="/settings">
          <ShieldCheck aria-hidden="true" size={16} />
          Security settings
        </Link>
        <button
          disabled={logoutMutation.isPending}
          onClick={() => {
            logoutMutation.mutate();
          }}
          type="button"
        >
          <LogOut aria-hidden="true" size={16} />
          {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>
  );
}
