import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AttachmentUploadError, uploadAttachment } from '../api/attachments';
import { ApiError } from '../api/client';
import {
  debtApi,
  type Debt,
  type DebtDirection,
  type DebtWriteInput,
} from '../api/debts';
import { FormField } from '../components/FormField';
import {
  AttachmentPanel,
  type QueuedAttachment,
} from '../expenses/AttachmentPanel';
import { usePreferences } from '../preferences/context';

const amountSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
    'Use a positive amount with up to four decimal places.',
  )
  .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero.');

const formSchema = z
  .object({
    customIntervalDays: z.string(),
    dueDate: z.string(),
    hasInstallments: z.boolean(),
    installmentAmount: z.string(),
    installmentFrequency: z.enum([
      'weekly',
      'monthly',
      'quarterly',
      'semiannual',
      'yearly',
      'custom',
    ]),
    interestNote: z.string().max(1000),
    name: z
      .string()
      .trim()
      .min(1, 'Add a person, company, or lender.')
      .max(160),
    nextPaymentDate: z.string(),
    notes: z.string().max(5000),
    originalAmount: amountSchema,
    startDate: z.string().min(1, 'Choose the start date.'),
  })
  .superRefine((values, context) => {
    if (values.dueDate && values.dueDate < values.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'The due date cannot be before the start date.',
        path: ['dueDate'],
      });
    }
    if (values.hasInstallments) {
      const installment = amountSchema.safeParse(values.installmentAmount);
      if (!installment.success) {
        context.addIssue({
          code: 'custom',
          message: installment.error.issues[0]?.message ?? 'Add an amount.',
          path: ['installmentAmount'],
        });
      }
      if (!values.nextPaymentDate) {
        context.addIssue({
          code: 'custom',
          message: 'Choose the next payment date.',
          path: ['nextPaymentDate'],
        });
      } else if (values.nextPaymentDate < values.startDate) {
        context.addIssue({
          code: 'custom',
          message: 'The next payment cannot be before the start date.',
          path: ['nextPaymentDate'],
        });
      }
      if (
        values.installmentFrequency === 'custom' &&
        (!/^\d+$/.test(values.customIntervalDays) ||
          Number(values.customIntervalDays) < 1 ||
          Number(values.customIntervalDays) > 3650)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Use a custom interval from 1 to 3650 days.',
          path: ['customIntervalDays'],
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

function amountInput(amount: string): string {
  return amount.includes('.')
    ? amount.replace(/0+$/, '').replace(/\.$/, '')
    : amount;
}

function defaultValues(debt: Debt | null, today: string): FormValues {
  return {
    customIntervalDays: debt?.customIntervalDays
      ? String(debt.customIntervalDays)
      : '',
    dueDate: debt?.dueDate ?? '',
    hasInstallments: debt?.installmentAmount != null,
    installmentAmount: debt?.installmentAmount
      ? amountInput(debt.installmentAmount)
      : '',
    installmentFrequency: debt?.installmentFrequency ?? 'monthly',
    interestNote: debt?.interestNote ?? '',
    name: debt?.name ?? '',
    nextPaymentDate: debt?.nextPaymentDate ?? '',
    notes: debt?.notes ?? '',
    originalAmount: debt ? amountInput(debt.originalAmount) : '',
    startDate: debt?.startDate ?? today,
  };
}

function toInput(values: FormValues, direction: DebtDirection): DebtWriteInput {
  return {
    customIntervalDays:
      values.hasInstallments && values.installmentFrequency === 'custom'
        ? Number(values.customIntervalDays)
        : null,
    direction,
    dueDate: values.dueDate || null,
    installmentAmount: values.hasInstallments ? values.installmentAmount : null,
    installmentFrequency: values.hasInstallments
      ? values.installmentFrequency
      : null,
    interestNote: values.interestNote || null,
    name: values.name,
    nextPaymentDate: values.hasInstallments
      ? values.nextPaymentDate || null
      : null,
    notes: values.notes || null,
    originalAmount: values.originalAmount,
    startDate: values.startDate,
  };
}

export function DebtFormDialog({
  debt,
  direction,
  onClose,
  open,
}: {
  debt: Debt | null;
  direction: DebtDirection;
  onClose: () => void;
  open: boolean;
}) {
  const { todayDate } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const [queuedAttachments, setQueuedAttachments] = useState<
    QueuedAttachment[]
  >([]);
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    defaultValues: defaultValues(debt, todayDate()),
    resolver: zodResolver(formSchema),
  });
  const hasInstallments = form.watch('hasInstallments');
  const frequency = form.watch('installmentFrequency');
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const saved = debt
        ? await debtApi.update(debt.id, toInput(values, debt.direction))
        : await debtApi.create(toInput(values, direction));
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
          await uploadAttachment({
            entityId: saved.id,
            entityType: 'debts',
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
                      error instanceof Error ? error.message : 'Upload failed.',
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
      return saved;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['debts'] }),
        queryClient.invalidateQueries({ queryKey: ['debt-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['debt-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['debt-attachments'] }),
        queryClient.invalidateQueries({ queryKey: ['attachment-storage'] }),
      ]);
      onClose();
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
      setQueuedAttachments([]);
      form.reset(defaultValues(debt, todayDate()));
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [debt, form, mutation, open, todayDate]);

  const closeDialog = () => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    onClose();
  };
  const error =
    mutation.error instanceof ApiError ||
    mutation.error instanceof AttachmentUploadError
      ? mutation.error.message
      : mutation.error
        ? 'The API could not be reached. Check that Docker is running, then try again.'
        : null;
  const directionLabel =
    (debt?.direction ?? direction) === 'i_owe'
      ? 'Money I owe'
      : 'Money owed to me';

  return (
    <dialog
      aria-labelledby="debt-dialog-title"
      className="expense-dialog subscription-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form
        className="expense-form subscription-form"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => mutation.mutate(values))(event);
        }}
      >
        <div className="dialog-heading">
          <div>
            <p>{directionLabel}</p>
            <h2 id="debt-dialog-title">
              {debt ? 'Edit loan or debt' : 'Add loan or debt'}
            </h2>
          </div>
          <button
            aria-label="Close loan or debt form"
            className="icon-button"
            onClick={closeDialog}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <div className="expense-form__primary subscription-form__primary">
          <FormField
            autoComplete="organization"
            error={form.formState.errors.name?.message}
            id="debt-name"
            label="Person, company, or lender"
            placeholder="Bank, family member, client…"
            {...form.register('name')}
          />
          <FormField
            autoComplete="off"
            error={form.formState.errors.originalAmount?.message}
            id="debt-original-amount"
            inputMode="decimal"
            label="Original amount"
            placeholder="0.00"
            {...form.register('originalAmount')}
          />
          <FormField
            error={form.formState.errors.startDate?.message}
            id="debt-start-date"
            label="Start date"
            type="date"
            {...form.register('startDate')}
          />
          <FormField
            error={form.formState.errors.dueDate?.message}
            id="debt-due-date"
            label="Final due date (optional)"
            min={form.watch('startDate')}
            type="date"
            {...form.register('dueDate')}
          />
        </div>

        <label className="toggle-field debt-installment-toggle">
          <input type="checkbox" {...form.register('hasInstallments')} />
          <span>
            <strong>Track an installment plan</strong>
            <small>Add the expected amount, schedule, and next date.</small>
          </span>
        </label>

        {hasInstallments ? (
          <div className="debt-installment-fields">
            <FormField
              error={form.formState.errors.installmentAmount?.message}
              id="debt-installment-amount"
              inputMode="decimal"
              label="Installment amount"
              placeholder="0.00"
              {...form.register('installmentAmount')}
            />
            <label className="form-field" htmlFor="debt-frequency">
              <span className="form-field__label">Frequency</span>
              <select
                className="form-field__input"
                id="debt-frequency"
                {...form.register('installmentFrequency')}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Every 3 months</option>
                <option value="semiannual">Every 6 months</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom interval</option>
              </select>
            </label>
            <FormField
              error={form.formState.errors.nextPaymentDate?.message}
              id="debt-next-payment-date"
              label="Next expected payment"
              min={form.watch('startDate')}
              type="date"
              {...form.register('nextPaymentDate')}
            />
            {frequency === 'custom' ? (
              <FormField
                error={form.formState.errors.customIntervalDays?.message}
                id="debt-custom-days"
                inputMode="numeric"
                label="Repeat every (days)"
                min={1}
                type="number"
                {...form.register('customIntervalDays')}
              />
            ) : null}
          </div>
        ) : null}

        <details className="more-details">
          <summary>
            Notes and interest details
            <ChevronDown aria-hidden="true" size={17} />
          </summary>
          <div className="more-details__fields">
            <label className="form-field" htmlFor="debt-interest-note">
              <span className="form-field__label">
                Interest note (optional)
              </span>
              <textarea
                className="form-field__input form-field__textarea"
                id="debt-interest-note"
                placeholder="Simple note only; no amortization is calculated"
                rows={3}
                {...form.register('interestNote')}
              />
            </label>
            <label className="form-field" htmlFor="debt-notes">
              <span className="form-field__label">Notes (optional)</span>
              <textarea
                className="form-field__input form-field__textarea"
                id="debt-notes"
                placeholder="Agreement details or useful context"
                rows={3}
                {...form.register('notes')}
              />
            </label>
          </div>
        </details>

        <AttachmentPanel
          entityId={debt?.id ?? null}
          entityType="debt"
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

        {error ? (
          <p className="form-message form-message--error" role="alert">
            The record could not be saved. Your changes are still on this
            screen. {error}
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
            {mutation.isPending ? 'Saving…' : 'Save loan or debt'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
