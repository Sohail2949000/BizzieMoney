import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AttachmentUploadError, uploadAttachment } from '../api/attachments';
import { ApiError } from '../api/client';
import type { ExpenseOptions } from '../api/expenses';
import {
  subscriptionApi,
  type Subscription,
  type SubscriptionWriteInput,
} from '../api/subscriptions';
import { FormField } from '../components/FormField';
import {
  AttachmentPanel,
  type QueuedAttachment,
} from '../expenses/AttachmentPanel';
import { usePreferences } from '../preferences/context';

const formSchema = z
  .object({
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
    autoRenew: z.boolean(),
    billingFrequency: z.enum([
      'weekly',
      'monthly',
      'quarterly',
      'semiannual',
      'yearly',
      'custom',
    ]),
    categoryId: z.string().min(1, 'Choose a category.'),
    customIntervalDays: z.string(),
    endDate: z.string(),
    name: z.string().trim().min(1, 'Add a subscription name.').max(160),
    nextPaymentDate: z.string().min(1, 'Choose the next payment date.'),
    notes: z.string().max(5000),
    reminderDays: z
      .string()
      .regex(/^\d{1,3}$/, 'Use a whole number from 0 to 365.')
      .refine((value) => Number(value) <= 365, 'Use 365 days or fewer.'),
    startDate: z.string(),
  })
  .superRefine((values, context) => {
    if (
      values.billingFrequency === 'custom' &&
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
    if (values.startDate && values.nextPaymentDate < values.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'The next payment cannot be before the start date.',
        path: ['nextPaymentDate'],
      });
    }
    if (values.endDate && values.endDate < values.nextPaymentDate) {
      context.addIssue({
        code: 'custom',
        message: 'The end date cannot be before the next payment.',
        path: ['endDate'],
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

function amountInput(amount: string): string {
  return amount.includes('.')
    ? amount.replace(/0+$/, '').replace(/\.$/, '')
    : amount;
}

function defaultValues(
  options: ExpenseOptions,
  subscription: Subscription | null,
  today: string,
): FormValues {
  return {
    amount: subscription ? amountInput(subscription.amount) : '',
    autoRenew: subscription?.autoRenew ?? true,
    billingFrequency: subscription?.billingFrequency ?? 'monthly',
    categoryId:
      subscription?.category.id ??
      options.categories.find((category) => !category.archived)?.id ??
      '',
    customIntervalDays: subscription?.customIntervalDays
      ? String(subscription.customIntervalDays)
      : '',
    endDate: subscription?.endDate ?? '',
    name: subscription?.name ?? '',
    nextPaymentDate: subscription?.nextPaymentDate ?? today,
    notes: subscription?.notes ?? '',
    reminderDays: String(subscription?.reminderDays ?? 3),
    startDate: subscription?.startDate ?? '',
  };
}

function toInput(values: FormValues): SubscriptionWriteInput {
  return {
    amount: values.amount,
    autoRenew: values.autoRenew,
    billingFrequency: values.billingFrequency,
    categoryId: values.categoryId,
    customIntervalDays:
      values.billingFrequency === 'custom'
        ? Number(values.customIntervalDays)
        : null,
    endDate: values.endDate || null,
    name: values.name,
    nextPaymentDate: values.nextPaymentDate,
    notes: values.notes || null,
    reminderDays: Number(values.reminderDays),
    startDate: values.startDate || null,
  };
}

export function SubscriptionFormDialog({
  onClose,
  open,
  options,
  subscription,
}: {
  onClose: () => void;
  open: boolean;
  options: ExpenseOptions;
  subscription: Subscription | null;
}) {
  const { todayDate } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const [queuedAttachments, setQueuedAttachments] = useState<
    QueuedAttachment[]
  >([]);
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    defaultValues: defaultValues(options, subscription, todayDate()),
    resolver: zodResolver(formSchema),
  });
  const frequency = form.watch('billingFrequency');
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const saved = subscription
        ? await subscriptionApi.update(subscription.id, toInput(values))
        : await subscriptionApi.create(toInput(values));
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
            entityType: 'subscriptions',
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
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-reminders'] }),
        queryClient.invalidateQueries({
          queryKey: ['subscription-attachments'],
        }),
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
      form.reset(defaultValues(options, subscription, todayDate()));
      mutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [form, mutation, open, options, subscription, todayDate]);

  const closeDialog = () => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    onClose();
  };
  const apiError =
    mutation.error instanceof ApiError ||
    mutation.error instanceof AttachmentUploadError
      ? mutation.error.message
      : mutation.error
        ? 'The API could not be reached. Check that Docker is running, then try again.'
        : null;

  return (
    <dialog
      aria-labelledby="subscription-dialog-title"
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
            <p>Recurring payment</p>
            <h2 id="subscription-dialog-title">
              {subscription ? 'Edit subscription' : 'Add subscription'}
            </h2>
          </div>
          <button
            aria-label="Close subscription form"
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
            id="subscription-name"
            label="Name"
            placeholder="Internet, insurance, software…"
            {...form.register('name')}
          />
          <FormField
            autoComplete="off"
            error={form.formState.errors.amount?.message}
            id="subscription-amount"
            inputMode="decimal"
            label="Amount"
            placeholder="0.00"
            {...form.register('amount')}
          />
          <label className="form-field" htmlFor="subscription-frequency">
            <span className="form-field__label">Billing frequency</span>
            <select
              className="form-field__input"
              id="subscription-frequency"
              {...form.register('billingFrequency')}
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
            id="subscription-next-payment"
            label="Next payment"
            type="date"
            {...form.register('nextPaymentDate')}
          />
          <label className="form-field" htmlFor="subscription-category">
            <span className="form-field__label">Category</span>
            <select
              className="form-field__input"
              id="subscription-category"
              {...form.register('categoryId')}
            >
              {options.categories
                .filter(
                  (category) =>
                    !category.archived ||
                    category.id === subscription?.category.id,
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.archived ? ' (archived)' : ''}
                  </option>
                ))}
            </select>
          </label>
          {frequency === 'custom' ? (
            <FormField
              error={form.formState.errors.customIntervalDays?.message}
              id="subscription-custom-days"
              inputMode="numeric"
              label="Repeat every (days)"
              min={1}
              type="number"
              {...form.register('customIntervalDays')}
            />
          ) : null}
        </div>

        <details className="more-details">
          <summary>
            More details
            <ChevronDown aria-hidden="true" size={17} />
          </summary>
          <div className="more-details__fields">
            <FormField
              error={form.formState.errors.reminderDays?.message}
              id="subscription-reminder-days"
              inputMode="numeric"
              label="Remind me this many days before"
              min={0}
              type="number"
              {...form.register('reminderDays')}
            />
            <FormField
              error={form.formState.errors.startDate?.message}
              id="subscription-start-date"
              label="Start date"
              type="date"
              {...form.register('startDate')}
            />
            <FormField
              error={form.formState.errors.endDate?.message}
              id="subscription-end-date"
              label="End date"
              min={form.watch('startDate') || undefined}
              type="date"
              {...form.register('endDate')}
            />
            <label className="toggle-field">
              <input type="checkbox" {...form.register('autoRenew')} />
              <span>
                <strong>Auto-renew enabled</strong>
                <small>
                  Turn this off when the next payment should be the last.
                </small>
              </span>
            </label>
            <label className="form-field" htmlFor="subscription-notes">
              <span className="form-field__label">Notes</span>
              <textarea
                className="form-field__input form-field__textarea"
                id="subscription-notes"
                placeholder="Optional account or cancellation details"
                rows={4}
                {...form.register('notes')}
              />
            </label>
          </div>
        </details>

        <AttachmentPanel
          entityId={subscription?.id ?? null}
          entityType="subscription"
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
            The subscription could not be saved. Your changes are still on this
            screen. {apiError}
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
              ? queuedAttachments.some(
                  (attachment) => attachment.status === 'uploading',
                )
                ? 'Uploading…'
                : 'Saving…'
              : 'Save subscription'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
