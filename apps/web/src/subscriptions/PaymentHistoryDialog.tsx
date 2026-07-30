import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ReceiptText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import type { ExpenseOptions } from '../api/expenses';
import {
  subscriptionApi,
  type Subscription,
  type SubscriptionPayment,
} from '../api/subscriptions';
import { usePreferences } from '../preferences/context';

function defaultPaymentMethod(options: ExpenseOptions): string {
  return (
    options.paymentMethods.find(
      (method) => !method.archived && method.name === 'Other',
    )?.id ??
    options.paymentMethods.find((method) => !method.archived)?.id ??
    ''
  );
}

export function PaymentHistoryDialog({
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
  const {
    formatDate: formatExpenseDate,
    formatMoney,
    todayDate,
  } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const recordKeyRef = useRef(globalThis.crypto.randomUUID());
  const conversionKeysRef = useRef(new Map<string, string>());
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(todayDate());
  const [paymentMethodId, setPaymentMethodId] = useState(
    defaultPaymentMethod(options),
  );
  const queryClient = useQueryClient();
  const paymentsQuery = useQuery({
    enabled: open && Boolean(subscription),
    queryFn: () => subscriptionApi.listPayments(subscription!.id),
    queryKey: ['subscription-payments', subscription?.id],
  });
  const recordMutation = useMutation({
    mutationFn: () =>
      subscriptionApi.recordPayment(
        subscription!.id,
        { amount: amount.trim() || null, paidDate },
        recordKeyRef.current,
      ),
    onSuccess: async () => {
      recordKeyRef.current = globalThis.crypto.randomUUID();
      setAmount('');
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['subscription-payments', subscription?.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-upcoming'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-reminders'] }),
      ]);
    },
  });
  const convertMutation = useMutation({
    mutationFn: (payment: SubscriptionPayment) => {
      const idempotencyKey =
        conversionKeysRef.current.get(payment.id) ??
        globalThis.crypto.randomUUID();
      conversionKeysRef.current.set(payment.id, idempotencyKey);
      return subscriptionApi.convertPayment(
        payment.id,
        paymentMethodId,
        idempotencyKey,
      );
    },
    onSuccess: async (_result, payment) => {
      conversionKeysRef.current.delete(payment.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['subscription-payments', subscription?.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
      ]);
    },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      recordKeyRef.current = globalThis.crypto.randomUUID();
      conversionKeysRef.current.clear();
      setAmount('');
      setPaidDate(todayDate());
      setPaymentMethodId(defaultPaymentMethod(options));
      recordMutation.reset();
      convertMutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [convertMutation, open, options, recordMutation, todayDate]);

  if (!subscription) return null;
  const payments = paymentsQuery.data?.items ?? [];
  const mutationError =
    recordMutation.error instanceof ApiError
      ? recordMutation.error.message
      : convertMutation.error instanceof ApiError
        ? convertMutation.error.message
        : recordMutation.error || convertMutation.error
          ? 'The payment action could not be completed.'
          : null;

  return (
    <dialog
      aria-labelledby="payment-history-title"
      className="expense-dialog payment-history-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="payment-history">
        <div className="dialog-heading">
          <div>
            <p>Payment history</p>
            <h2 id="payment-history-title">{subscription.name}</h2>
          </div>
          <button
            aria-label="Close payment history"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        {subscription.status === 'active' ? (
          <form
            className="record-payment"
            onSubmit={(event) => {
              event.preventDefault();
              recordMutation.mutate();
            }}
          >
            <div>
              <p>Record this payment</p>
              <strong>
                Due {formatExpenseDate(subscription.nextPaymentDate)}
              </strong>
            </div>
            <label className="form-field" htmlFor="subscription-paid-date">
              <span className="form-field__label">Paid date</span>
              <input
                className="form-field__input"
                id="subscription-paid-date"
                onChange={(event) => setPaidDate(event.target.value)}
                required
                type="date"
                value={paidDate}
              />
            </label>
            <label className="form-field" htmlFor="subscription-paid-amount">
              <span className="form-field__label">Amount</span>
              <input
                className="form-field__input"
                id="subscription-paid-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                pattern="^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$"
                placeholder={formatMoney(
                  subscription.amount,
                  subscription.currencyCode,
                )}
                value={amount}
              />
              <span className="form-field__hint">
                Leave blank to use the subscription amount.
              </span>
            </label>
            <button
              className="button button--primary"
              disabled={recordMutation.isPending}
              type="submit"
            >
              <Check aria-hidden="true" size={16} />
              {recordMutation.isPending ? 'Recording…' : 'Record payment'}
            </button>
          </form>
        ) : (
          <p className="payment-history__notice">
            Resume this subscription to record its next scheduled payment.
          </p>
        )}

        <div className="payment-conversion-method">
          <label htmlFor="conversion-payment-method">
            Payment method for expense conversion
          </label>
          <select
            id="conversion-payment-method"
            onChange={(event) => setPaymentMethodId(event.target.value)}
            value={paymentMethodId}
          >
            {options.paymentMethods
              .filter((method) => !method.archived)
              .map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
          </select>
        </div>

        {paymentsQuery.isPending ? (
          <p className="payment-history__state" role="status">
            Loading payment history…
          </p>
        ) : paymentsQuery.isError ? (
          <p className="payment-history__state" role="alert">
            Payment history could not be loaded.
          </p>
        ) : payments.length === 0 ? (
          <div className="payment-history__empty">
            <ReceiptText aria-hidden="true" size={20} />
            <strong>No recorded payments yet.</strong>
            <span>The first payment will appear here after you record it.</span>
          </div>
        ) : (
          <ol className="payment-list">
            {payments.map((payment) => (
              <li key={payment.id}>
                <div>
                  <strong>
                    {formatMoney(payment.amount, payment.currencyCode)}
                  </strong>
                  <span>
                    Paid {formatExpenseDate(payment.paidDate)} · due{' '}
                    {formatExpenseDate(payment.scheduledDate)}
                  </span>
                </div>
                {payment.convertedExpenseId ? (
                  <Link
                    className="payment-converted"
                    onClick={onClose}
                    title="View expenses"
                    to="/expenses"
                  >
                    Expense created
                    <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                ) : (
                  <button
                    className="button button--secondary button--small"
                    disabled={
                      !paymentMethodId ||
                      (convertMutation.isPending &&
                        convertMutation.variables?.id === payment.id)
                    }
                    onClick={() => convertMutation.mutate(payment)}
                    type="button"
                  >
                    Convert to expense
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}

        {mutationError ? (
          <p className="form-message form-message--error" role="alert">
            {mutationError}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
