import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  AttachmentUploadError,
  uploadExpenseAttachment,
} from '../api/attachments';
import {
  expenseApi,
  type Expense,
  type ExpenseOptions,
  type ExpenseWriteInput,
} from '../api/expenses';
import { ApiError } from '../api/client';
import { FormField } from '../components/FormField';
import { usePreferences } from '../preferences/context';
import { AttachmentPanel, type QueuedAttachment } from './AttachmentPanel';

const formSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(
      /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
      'Use a positive amount with up to four decimal places.',
    )
    .refine(
      (value) => /[1-9]/.test(value),
      'Amount must be greater than zero.',
    ),
  categoryId: z.string().min(1, 'Choose a category.'),
  date: z.string().min(1, 'Choose a date.'),
  description: z.string().trim().min(1, 'Add a description.').max(160),
  merchant: z.string().max(120),
  notes: z.string().max(5000),
  paymentMethodId: z.string(),
  tags: z.string().max(420),
});

type FormValues = z.infer<typeof formSchema>;
export type ExpenseFormMode = 'create' | 'duplicate' | 'edit';

class ExpenseCleanupError extends Error {
  constructor(uploadError: unknown) {
    const uploadMessage =
      uploadError instanceof Error
        ? ` The attachment error was: ${uploadError.message}`
        : '';
    super(
      'The expense was saved, but its failed attachment could not be cleaned up automatically. Close this form, then edit or delete the saved expense before trying again.' +
        uploadMessage,
    );
    this.name = 'ExpenseCleanupError';
  }
}

function defaultPaymentMethod(options: ExpenseOptions): string {
  return (
    options.paymentMethods.find(
      (item) => !item.archived && item.name === 'Other',
    )?.id ??
    options.paymentMethods.find((item) => !item.archived)?.id ??
    ''
  );
}

function defaultValues(
  options: ExpenseOptions,
  expense: Expense | null,
  today: string,
): FormValues {
  return {
    amount: expense
      ? expense.amount.includes('.')
        ? expense.amount.replace(/0+$/, '').replace(/\.$/, '')
        : expense.amount
      : '',
    categoryId:
      expense?.category.id ??
      options.categories.find((item) => !item.archived)?.id ??
      '',
    date: expense?.date ?? today,
    description: expense?.description ?? '',
    merchant: expense?.merchant ?? '',
    notes: expense?.notes ?? '',
    paymentMethodId: expense?.paymentMethod.id ?? defaultPaymentMethod(options),
    tags: expense?.tags.join(', ') ?? '',
  };
}

function toInput(values: FormValues): ExpenseWriteInput {
  return {
    amount: values.amount,
    categoryId: values.categoryId,
    date: values.date,
    description: values.description,
    merchant: values.merchant || null,
    notes: values.notes || null,
    paymentMethodId: values.paymentMethodId || null,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export function ExpenseFormDialog({
  expense,
  mode,
  onClose,
  open,
  options,
}: {
  expense: Expense | null;
  mode: ExpenseFormMode;
  onClose: () => void;
  open: boolean;
  options: ExpenseOptions;
}) {
  const { todayDate } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const idempotencyKeyRef = useRef(globalThis.crypto.randomUUID());
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const [queuedAttachments, setQueuedAttachments] = useState<
    QueuedAttachment[]
  >([]);
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    defaultValues: defaultValues(options, expense, todayDate()),
    resolver: zodResolver(formSchema),
  });
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const input = toInput(values);
      const isExistingExpense = mode === 'edit' && expense;
      const saved = await (isExistingExpense
        ? expenseApi.update(expense.id, input)
        : expenseApi.create(input, idempotencyKeyRef.current));
      try {
        for (const item of queuedAttachments) {
          const controller = new AbortController();
          uploadControllersRef.current.set(item.id, controller);
          setQueuedAttachments((current) =>
            current.map((queued) =>
              queued.id === item.id
                ? {
                    ...queued,
                    error: null,
                    progress: 0,
                    status: 'uploading',
                  }
                : queued,
            ),
          );
          try {
            await uploadExpenseAttachment({
              expenseId: saved.id,
              file: item.file,
              idempotencyKey: item.idempotencyKey,
              onProgress: (progress) =>
                setQueuedAttachments((current) =>
                  current.map((queued) =>
                    queued.id === item.id ? { ...queued, progress } : queued,
                  ),
                ),
              signal: controller.signal,
            });
            setQueuedAttachments((current) =>
              current.filter((queued) => queued.id !== item.id),
            );
          } catch (error) {
            setQueuedAttachments((current) =>
              current.map((queued) =>
                queued.id === item.id
                  ? {
                      ...queued,
                      error:
                        error instanceof Error
                          ? error.message
                          : 'Upload failed.',
                      status: 'failed',
                    }
                  : queued,
              ),
            );
            throw error;
          } finally {
            uploadControllersRef.current.delete(item.id);
          }
        }
      } catch (error) {
        if (!isExistingExpense) {
          try {
            await expenseApi.delete(saved.id);
            idempotencyKeyRef.current = globalThis.crypto.randomUUID();
          } catch {
            throw new ExpenseCleanupError(error);
          }
        }
        throw error;
      }
      return saved;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
        queryClient.invalidateQueries({
          queryKey: ['expense-attachments'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['attachment-storage'],
        }),
      ]);
      onClose();
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
        queryClient.invalidateQueries({
          queryKey: ['expense-attachments'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['attachment-storage'],
        }),
      ]);
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      idempotencyKeyRef.current = globalThis.crypto.randomUUID();
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
      setQueuedAttachments([]);
      form.reset(defaultValues(options, expense, todayDate()));
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [expense, form, mode, mutation, open, options, todayDate]);

  const title =
    mode === 'edit'
      ? 'Edit expense'
      : mode === 'duplicate'
        ? 'Duplicate expense'
        : 'Add expense';
  const submitLabel =
    mode === 'edit'
      ? 'Save changes'
      : mode === 'duplicate'
        ? 'Create duplicate'
        : 'Save expense';
  const apiError =
    mutation.error instanceof ApiError ||
    mutation.error instanceof AttachmentUploadError ||
    mutation.error instanceof ExpenseCleanupError
      ? mutation.error.message
      : mutation.error
        ? 'The API could not be reached. Check that Docker is running, then try again.'
        : null;
  const closeDialog = () => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    onClose();
  };

  return (
    <dialog
      aria-labelledby="expense-dialog-title"
      className="expense-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form
        className="expense-form"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => mutation.mutate(values))(event);
        }}
      >
        <div className="dialog-heading">
          <div>
            <p>Expense details</p>
            <h2 id="expense-dialog-title">{title}</h2>
          </div>
          <button
            aria-label="Close expense form"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <div className="expense-form__primary">
          <FormField
            autoComplete="off"
            error={form.formState.errors.amount?.message}
            id="expense-amount"
            inputMode="decimal"
            label="Amount"
            placeholder="0.00"
            {...form.register('amount')}
          />
          <FormField
            autoComplete="off"
            error={form.formState.errors.description?.message}
            id="expense-description"
            label="Description"
            placeholder="What was this for?"
            {...form.register('description')}
          />
          <label className="form-field" htmlFor="expense-category">
            <span className="form-field__label">Category</span>
            <select
              className="form-field__input"
              id="expense-category"
              {...form.register('categoryId')}
            >
              {options.categories
                .filter(
                  (item) => !item.archived || item.id === expense?.category.id,
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.archived ? ' (archived)' : ''}
                  </option>
                ))}
            </select>
            {form.formState.errors.categoryId ? (
              <span className="form-field__error" role="alert">
                {form.formState.errors.categoryId.message}
              </span>
            ) : null}
          </label>
          <FormField
            autoComplete="off"
            error={form.formState.errors.date?.message}
            id="expense-date"
            label="Date"
            type="date"
            {...form.register('date')}
          />
        </div>

        <details className="more-details">
          <summary>
            More details
            <ChevronDown aria-hidden="true" size={17} />
          </summary>
          <div className="more-details__fields">
            <label className="form-field" htmlFor="expense-payment-method">
              <span className="form-field__label">Payment method</span>
              <select
                className="form-field__input"
                id="expense-payment-method"
                {...form.register('paymentMethodId')}
              >
                {options.paymentMethods
                  .filter(
                    (item) =>
                      !item.archived || item.id === expense?.paymentMethod.id,
                  )
                  .map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                      {method.archived ? ' (archived)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <FormField
              autoComplete="organization"
              error={form.formState.errors.merchant?.message}
              id="expense-merchant"
              label="Merchant"
              placeholder="Optional"
              {...form.register('merchant')}
            />
            <FormField
              autoComplete="off"
              error={form.formState.errors.tags?.message}
              hint="Separate tags with commas."
              id="expense-tags"
              label="Tags"
              placeholder="work, reimbursable"
              {...form.register('tags')}
            />
            <label className="form-field" htmlFor="expense-notes">
              <span className="form-field__label">Notes</span>
              <textarea
                className="form-field__input form-field__textarea"
                id="expense-notes"
                placeholder="Optional context"
                rows={4}
                {...form.register('notes')}
              />
              {form.formState.errors.notes ? (
                <span className="form-field__error" role="alert">
                  {form.formState.errors.notes.message}
                </span>
              ) : null}
            </label>
          </div>
        </details>

        <AttachmentPanel
          entityId={mode === 'edit' && expense ? expense.id : null}
          entityType="expense"
          onCancel={(id) => {
            uploadControllersRef.current.get(id)?.abort();
            setQueuedAttachments((current) =>
              current.filter((item) => item.id !== id),
            );
          }}
          onQueueChange={setQueuedAttachments}
          onRetry={(id) =>
            setQueuedAttachments((current) =>
              current.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      error: null,
                      progress: 0,
                      status: 'queued',
                    }
                  : item,
              ),
            )
          }
          queued={queuedAttachments}
        />

        {apiError ? (
          <p className="form-message form-message--error" role="alert">
            {mutation.error instanceof ExpenseCleanupError ? (
              apiError
            ) : (
              <>
                The expense could not be saved. Your changes are still on this
                screen. {apiError}
              </>
            )}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={mutation.isPending}
            type="submit"
          >
            {mutation.isPending
              ? queuedAttachments.some((item) => item.status === 'uploading')
                ? 'Uploading…'
                : 'Saving…'
              : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
