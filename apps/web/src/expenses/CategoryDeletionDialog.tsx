import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  expenseApi,
  type CategoryDeletionResult,
  type MoneyOption,
} from '../api/expenses';
import { ApiError } from '../api/client';
import { ExpenseOptionIcon } from './icons';

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function CategoryDeletionDialog({
  category,
  onClose,
  onDeleted,
}: {
  category: MoneyOption | null;
  onClose: () => void;
  onDeleted: (result: CategoryDeletionResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedReplacementId, setSelectedReplacementId] = useState<
    string | null
  >(null);
  const previewQuery = useQuery({
    enabled: category !== null,
    queryFn: () => expenseApi.getCategoryDeletionPreview(category!.id),
    queryKey: ['category-deletion-preview', category?.id],
  });
  const mutation = useMutation({
    mutationFn: (replacementCategoryId: string) =>
      expenseApi.deleteCategory(category!.id, replacementCategoryId),
    onSuccess: onDeleted,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (category && !dialog.open) {
      setSelectedReplacementId(null);
      mutation.reset();
      dialog.showModal();
    } else if (!category && dialog.open) {
      dialog.close();
    }
  }, [category, mutation]);

  const replacements = previewQuery.data?.replacements ?? [];
  const defaultReplacement =
    replacements.find((item) => item.name === 'Other') ?? replacements[0];
  const replacementId = replacements.some(
    (item) => item.id === selectedReplacementId,
  )
    ? selectedReplacementId!
    : (defaultReplacement?.id ?? '');
  const replacement =
    replacements.find((item) => item.id === replacementId) ??
    defaultReplacement;
  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'The category could not be deleted. Nothing was partially changed.'
        : previewQuery.error instanceof ApiError
          ? previewQuery.error.message
          : previewQuery.error
            ? 'Category usage could not be loaded.'
            : null;

  return (
    <dialog
      aria-labelledby="category-deletion-title"
      className="expense-dialog category-deletion-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!mutation.isPending) onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form
        className="expense-form category-deletion"
        onSubmit={(event) => {
          event.preventDefault();
          if (replacementId && !mutation.isPending) {
            mutation.mutate(replacementId);
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <p>Permanent category change</p>
            <h2 id="category-deletion-title">Delete {category?.name}</h2>
          </div>
          <button
            aria-label="Close category deletion"
            className="icon-button"
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <div className="category-deletion__warning">
          <TriangleAlert aria-hidden="true" size={22} />
          <div>
            <strong>The category itself will be permanently removed.</strong>
            <p>
              Amounts, dates, payment details, and attachments will stay
              unchanged.
            </p>
          </div>
        </div>

        {previewQuery.isPending ? (
          <p className="settings-muted" role="status">
            Checking category usage…
          </p>
        ) : previewQuery.data ? (
          <>
            <div className="category-deletion__move">
              <div>
                <span
                  aria-hidden="true"
                  className="money-option__icon"
                  style={{ color: previewQuery.data.category.color }}
                >
                  <ExpenseOptionIcon name={previewQuery.data.category.icon} />
                </span>
                <span>
                  <strong>{previewQuery.data.category.name}</strong>
                  <small>
                    {countLabel(previewQuery.data.expenseCount, 'expense')} ·{' '}
                    {countLabel(
                      previewQuery.data.subscriptionCount,
                      'subscription',
                    )}
                  </small>
                </span>
              </div>
              <ArrowRight aria-hidden="true" size={18} />
              <div>
                {defaultReplacement ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="money-option__icon"
                      style={{
                        color: replacement?.color ?? '#71717A',
                      }}
                    >
                      <ExpenseOptionIcon
                        name={replacement?.icon ?? 'circle-ellipsis'}
                      />
                    </span>
                    <span>
                      <strong>
                        {replacement?.name ?? defaultReplacement.name}
                      </strong>
                      <small>Replacement category</small>
                    </span>
                  </>
                ) : (
                  <span>
                    <strong>No replacement is available</strong>
                    <small>Create or restore another category first.</small>
                  </span>
                )}
              </div>
            </div>

            {replacements.length > 0 ? (
              <label className="form-field" htmlFor="replacement-category">
                <span>Move records to</span>
                <select
                  id="replacement-category"
                  onChange={(event) =>
                    setSelectedReplacementId(event.target.value)
                  }
                  value={replacementId}
                >
                  {replacements.map((replacement) => (
                    <option key={replacement.id} value={replacement.id}>
                      {replacement.name}
                    </option>
                  ))}
                </select>
                <small>
                  Existing expenses and subscriptions will use this category.
                </small>
              </label>
            ) : null}
          </>
        ) : null}

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
            disabled={
              !replacementId || previewQuery.isPending || mutation.isPending
            }
            type="submit"
          >
            {mutation.isPending ? (
              'Reassigning…'
            ) : (
              <>
                <Trash2 aria-hidden="true" size={16} />
                Reassign and delete
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
