import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { expenseApi, type ExpenseImportPreview } from '../api/expenses';
import { ApiError } from '../api/client';

const maximumFileBytes = 2_000_000;

export function ExpenseImportDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const idempotencyKeyRef = useRef(globalThis.crypto.randomUUID());
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExpenseImportPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: expenseApi.previewImport,
    onSuccess: setPreview,
  });
  const importMutation = useMutation({
    mutationFn: () => expenseApi.importCsv(csvText, idempotencyKeyRef.current),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
      ]);
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      idempotencyKeyRef.current = globalThis.crypto.randomUUID();
      setCsvText('');
      setFileName('');
      setFileError(null);
      setPreview(null);
      previewMutation.reset();
      importMutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [importMutation, open, previewMutation]);

  const chooseFile = async (file: File | undefined) => {
    setFileError(null);
    setPreview(null);
    previewMutation.reset();
    importMutation.reset();
    idempotencyKeyRef.current = globalThis.crypto.randomUUID();
    if (!file) {
      setCsvText('');
      setFileName('');
      return;
    }
    setFileName(file.name);
    if (
      !file.name.toLocaleLowerCase('en-US').endsWith('.csv') &&
      file.type !== 'text/csv'
    ) {
      setCsvText('');
      setFileError('Choose a .csv file.');
      return;
    }
    if (file.size > maximumFileBytes) {
      setCsvText('');
      setFileError('Choose a CSV file no larger than 2 MB.');
      return;
    }
    try {
      const text = await file.text();
      setCsvText(text);
      previewMutation.mutate(text);
    } catch {
      setCsvText('');
      setFileError('This file could not be read. Choose it again.');
    }
  };

  const previewError =
    previewMutation.error instanceof ApiError
      ? previewMutation.error.message
      : previewMutation.error
        ? 'The preview could not be prepared. Check that Docker is running.'
        : null;
  const importError =
    importMutation.error instanceof ApiError
      ? importMutation.error.message
      : importMutation.error
        ? 'The import could not be completed. Check that Docker is running.'
        : null;
  const result = importMutation.data;

  return (
    <dialog
      aria-labelledby="expense-import-title"
      className="expense-dialog expense-import-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="expense-form expense-import">
        <div className="dialog-heading">
          <div>
            <p>Bulk expenses</p>
            <h2 id="expense-import-title">Import CSV</h2>
          </div>
          <button
            aria-label="Close expense import"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        {result ? (
          <div className="expense-import__success" role="status">
            <span>
              <CheckCircle2 aria-hidden="true" size={22} />
            </span>
            <div>
              <strong>
                {result.importedCount} expense
                {result.importedCount === 1 ? '' : 's'} imported
              </strong>
              <p>
                {Object.entries(result.currencyCounts)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([currency, count]) => `${count} ${currency}`)
                  .join(' · ')}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="expense-import__guide">
              <FileSpreadsheet aria-hidden="true" size={21} />
              <div>
                <strong>BizzieMoney exports are ready to re-import</strong>
                <p>
                  Required columns: Date, Description, Amount. Currency,
                  Category, Payment method, Merchant, Notes, and semicolon
                  separated Tags are optional.
                </p>
              </div>
            </div>

            <label className="expense-import__picker">
              <FileUp aria-hidden="true" size={22} />
              <span>
                <strong>{fileName || 'Choose a CSV file'}</strong>
                <small>Up to 1,000 rows and 2 MB</small>
              </span>
              <input
                accept=".csv,text/csv"
                aria-label="Choose expense CSV"
                onChange={(event) => {
                  void chooseFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
                type="file"
              />
            </label>

            {fileError || previewError ? (
              <p className="form-message form-message--error" role="alert">
                {fileError ?? previewError}
              </p>
            ) : null}
            {previewMutation.isPending ? (
              <div className="expense-import__loading" role="status">
                Checking every row…
              </div>
            ) : null}
            {preview ? <ImportPreview preview={preview} /> : null}
            {importError ? (
              <p className="form-message form-message--error" role="alert">
                No expenses were imported. {importError}
              </p>
            ) : null}
          </>
        )}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={onClose}
            type="button"
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result ? (
            <button
              className="button button--primary"
              disabled={
                !preview || preview.errorCount > 0 || importMutation.isPending
              }
              onClick={() => importMutation.mutate()}
              type="button"
            >
              {importMutation.isPending
                ? 'Importing…'
                : `Import ${preview?.validCount ?? 0} expense${
                    preview?.validCount === 1 ? '' : 's'
                  }`}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

function ImportPreview({ preview }: { preview: ExpenseImportPreview }) {
  return (
    <section aria-labelledby="expense-import-preview-title">
      <div className="expense-import__summary">
        <div>
          <p id="expense-import-preview-title">Preview</p>
          <strong>
            {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} checked
          </strong>
        </div>
        <span
          className={
            preview.errorCount > 0
              ? 'expense-import__count expense-import__count--error'
              : 'expense-import__count'
          }
        >
          {preview.errorCount > 0 ? (
            <AlertCircle aria-hidden="true" size={15} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={15} />
          )}
          {preview.errorCount > 0
            ? `${preview.errorCount} to fix`
            : 'Ready to import'}
        </span>
      </div>

      <div className="expense-import__table-wrap">
        <table className="expense-import__table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr
                className={row.valid ? undefined : 'is-invalid'}
                key={row.rowNumber}
              >
                <td data-label="Row">{row.rowNumber}</td>
                <td data-label="Date">{row.date || '—'}</td>
                <td data-label="Description">{row.description || '—'}</td>
                <td data-label="Amount">
                  {row.amount || '—'} {row.currencyCode}
                </td>
                <td data-label="Category">{row.categoryName}</td>
                <td data-label="Status">
                  {row.valid ? (
                    <span className="expense-import__valid">
                      <CheckCircle2 aria-hidden="true" size={14} />
                      Valid
                    </span>
                  ) : (
                    <ul className="expense-import__errors">
                      {row.errors.map((item, index) => (
                        <li key={`${item.field}-${index}`}>{item.message}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
