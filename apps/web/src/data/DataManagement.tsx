import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, ShieldAlert, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { financialDataApi, type FinancialPurgeResult } from '../api/data';
import { SettingsDisclosure } from '../components/SettingsDisclosure';

const confirmationPhrase = 'DELETE ALL DATA';

function downloadArchive(blob: Blob): void {
  const fileDate = new Date().toISOString().slice(0, 10);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `bizziemoney-full-export-${fileDate}.tar.gz`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function DataManagement() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastPurge, setLastPurge] = useState<FinancialPurgeResult | null>(null);
  const exportMutation = useMutation({
    mutationFn: financialDataApi.exportPortable,
    onSuccess: downloadArchive,
  });
  const exportError =
    exportMutation.error instanceof ApiError
      ? exportMutation.error.message
      : exportMutation.error
        ? 'The export could not be created. Try again after checking storage.'
        : null;

  return (
    <>
      <SettingsDisclosure
        eyebrow="Data"
        icon={<Archive size={19} />}
        id="data-management"
        title="Export or delete financial data"
      >
        <div className="data-management-list">
          <div className="data-management-row">
            <div>
              <strong>Portable full-data export</strong>
              <span>
                Download readable JSON Lines plus every stored attachment in one
                compressed archive.
              </span>
            </div>
            <button
              className="button button--secondary"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
              type="button"
            >
              <Download aria-hidden="true" size={16} />
              {exportMutation.isPending ? 'Preparing…' : 'Download export'}
            </button>
          </div>
          <div className="data-management-row data-management-row--danger">
            <div>
              <strong>Delete financial data</strong>
              <span>
                Permanently remove expenses, subscriptions, debts, payments,
                tags, and live attachments.
              </span>
            </div>
            <button
              className="button button--danger"
              onClick={() => {
                setLastPurge(null);
                setDialogOpen(true);
              }}
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
              Delete data…
            </button>
          </div>
        </div>
        <p className="data-management-note">
          Account details, regional preferences, categories, payment methods,
          security history, and backup history are not deleted.
        </p>
        {exportError ? (
          <p className="form-message form-message--error" role="alert">
            {exportError}
          </p>
        ) : null}
        {exportMutation.isSuccess ? (
          <p className="form-message form-message--success" role="status">
            Your portable export was downloaded.
          </p>
        ) : null}
        {lastPurge ? (
          <p className="form-message form-message--success" role="status">
            Financial data was deleted. {lastPurge.attachmentFilesQueued} stored
            file
            {lastPurge.attachmentFilesQueued === 1 ? '' : 's'} queued for secure
            cleanup.
          </p>
        ) : null}
      </SettingsDisclosure>
      <PurgeDialog
        onClose={() => setDialogOpen(false)}
        onSuccess={(result) => {
          setLastPurge(result);
          setDialogOpen(false);
          void queryClient.invalidateQueries();
        }}
        open={dialogOpen}
      />
    </>
  );
}

function PurgeDialog({
  onClose,
  onSuccess,
  open,
}: {
  onClose: () => void;
  onSuccess: (result: FinancialPurgeResult) => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const idempotencyKeyRef = useRef(globalThis.crypto.randomUUID());
  const [confirmation, setConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      financialDataApi.purge(
        { confirmation, currentPassword },
        idempotencyKeyRef.current,
      ),
    onSuccess,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      idempotencyKeyRef.current = globalThis.crypto.randomUUID();
      setConfirmation('');
      setCurrentPassword('');
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [mutation, open]);

  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Financial data could not be deleted. Nothing was partially removed.'
        : null;
  const ready =
    confirmation === confirmationPhrase && currentPassword.length > 0;

  return (
    <dialog
      aria-labelledby="data-purge-title"
      className="expense-dialog data-purge-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!mutation.isPending) onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form
        className="expense-form data-purge"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutation.isPending) mutation.mutate();
        }}
      >
        <div className="dialog-heading">
          <div>
            <p>Permanent action</p>
            <h2 id="data-purge-title">Delete financial data</h2>
          </div>
          <button
            aria-label="Close data deletion"
            className="icon-button"
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <div className="data-purge__warning">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <strong>This cannot be undone from the live application.</strong>
            <p>
              Expenses, subscriptions, debts, payment history, tags, and
              attached files will be removed. Your owner account, preferences,
              categories, and payment methods will remain.
            </p>
          </div>
        </div>

        <div className="data-purge__backup-note">
          <strong>Existing backups are not deleted.</strong>
          <p>
            Older backups may still contain the financial data being removed.
            Delete those backup artifacts separately if you no longer want them
            retained.
          </p>
        </div>

        <label className="form-field" htmlFor="purge-current-password">
          <span>Current password</span>
          <input
            autoComplete="current-password"
            id="purge-current-password"
            maxLength={128}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label className="form-field" htmlFor="purge-confirmation">
          <span>
            Type <b>{confirmationPhrase}</b> to confirm
          </span>
          <input
            autoComplete="off"
            id="purge-confirmation"
            maxLength={100}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            spellCheck={false}
            type="text"
            value={confirmation}
          />
        </label>

        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--danger"
            disabled={!ready || mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? (
              'Deleting…'
            ) : (
              <>
                <Trash2 aria-hidden="true" size={16} />
                Permanently delete
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
