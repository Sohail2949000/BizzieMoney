import { AlertCircle, LoaderCircle } from 'lucide-react';

import { AuthBrand } from '../components/Brand';

export function AuthStatusPage({
  kind,
  onRetry,
}: {
  kind: 'error' | 'loading';
  onRetry?: () => void;
}) {
  const isLoading = kind === 'loading';
  return (
    <main className="status-page">
      <AuthBrand />
      <div className="status-page__panel" role={isLoading ? 'status' : 'alert'}>
        {isLoading ? (
          <LoaderCircle aria-hidden="true" className="spin" size={24} />
        ) : (
          <AlertCircle aria-hidden="true" size={24} />
        )}
        <h1>
          {isLoading ? 'Opening your private space…' : 'BizzieMoney is offline'}
        </h1>
        <p>
          {isLoading
            ? 'Checking the owner account and secure session.'
            : 'The API could not be reached. Your data was not changed.'}
        </p>
        {!isLoading && onRetry ? (
          <button
            className="button button--primary"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
    </main>
  );
}
