import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Edit3,
  History,
  Paperclip,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { AttachmentUploadError, uploadAttachment } from '../api/attachments';
import { ApiError } from '../api/client';
import {
  debtApi,
  type Debt,
  type DebtPayment,
  type DebtPaymentWriteInput,
} from '../api/debts';
import {
  AttachmentPanel,
  type QueuedAttachment,
} from '../expenses/AttachmentPanel';
import { usePreferences } from '../preferences/context';

function paymentInput(
  amount: string,
  notes: string,
  paymentDate: string,
  allowOverpayment: boolean,
): DebtPaymentWriteInput {
  return {
    allowOverpayment,
    amount: amount.trim(),
    notes: notes.trim() || null,
    paymentDate,
  };
}

function amountInput(amount: string): string {
  return amount.includes('.')
    ? amount.replace(/0+$/, '').replace(/\.$/, '')
    : amount;
}

export function DebtPaymentHistoryDialog({
  debt,
  onClose,
  open,
}: {
  debt: Debt | null;
  onClose: () => void;
  open: boolean;
}) {
  const {
    formatDate: formatExpenseDate,
    formatMoney,
    todayDate,
  } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const recordKeyRef = useRef(globalThis.crypto.randomUUID());
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const [amount, setAmount] = useState('');
  const [editingPayment, setEditingPayment] = useState<DebtPayment | null>(
    null,
  );
  const [notes, setNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayDate());
  const [queuedAttachments, setQueuedAttachments] = useState<
    QueuedAttachment[]
  >([]);
  const queryClient = useQueryClient();
  const paymentsQuery = useQuery({
    enabled: open && Boolean(debt),
    queryFn: () => debtApi.listPayments(debt!.id),
    queryKey: ['debt-payments', debt?.id],
  });
  const debtQuery = useQuery({
    enabled: open && Boolean(debt),
    queryFn: () => debtApi.get(debt!.id),
    queryKey: ['debt', debt?.id],
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['debt-payments', debt?.id],
      }),
      queryClient.invalidateQueries({ queryKey: ['debt', debt?.id] }),
      queryClient.invalidateQueries({ queryKey: ['debts'] }),
      queryClient.invalidateQueries({ queryKey: ['debt-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['debt-upcoming'] }),
      queryClient.invalidateQueries({
        queryKey: ['debt_payment-attachments'],
      }),
      queryClient.invalidateQueries({ queryKey: ['attachment-storage'] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const liveDebt = debtQuery.data ?? debt;
      if (!liveDebt) throw new Error('No debt selected.');
      const save = (allowOverpayment: boolean) =>
        editingPayment
          ? debtApi.updatePayment(
              editingPayment.id,
              paymentInput(amount, notes, paymentDate, allowOverpayment),
            )
          : debtApi.recordPayment(
              liveDebt.id,
              paymentInput(amount, notes, paymentDate, allowOverpayment),
              recordKeyRef.current,
            );
      let saved: DebtPayment;
      try {
        saved = await save(false);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === 'DEBT_PAYMENT_EXCEEDS_REMAINING' &&
          globalThis.confirm(
            `This payment is higher than the remaining ${formatMoney(
              liveDebt.remainingAmount,
              liveDebt.currencyCode,
            )}. Record the overpayment anyway?`,
          )
        ) {
          saved = await save(true);
        } else {
          throw error;
        }
      }

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
            entityType: 'debt-payments',
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
      recordKeyRef.current = globalThis.crypto.randomUUID();
      setAmount('');
      setEditingPayment(null);
      setNotes('');
      setPaymentDate(todayDate());
      setQueuedAttachments([]);
      await invalidate();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: debtApi.deletePayment,
    onSuccess: invalidate,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      recordKeyRef.current = globalThis.crypto.randomUUID();
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
      setAmount('');
      setEditingPayment(null);
      setNotes('');
      setPaymentDate(todayDate());
      setQueuedAttachments([]);
      saveMutation.reset();
      deleteMutation.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [deleteMutation, open, saveMutation, todayDate]);

  if (!debt) return null;
  const currentDebt = debtQuery.data ?? debt;
  const payments = paymentsQuery.data?.items ?? [];
  const canRecord = ['active', 'overdue'].includes(currentDebt.status);
  const error =
    saveMutation.error instanceof ApiError ||
    saveMutation.error instanceof AttachmentUploadError
      ? saveMutation.error.message
      : deleteMutation.error instanceof ApiError
        ? deleteMutation.error.message
        : saveMutation.error || deleteMutation.error
          ? 'The payment action could not be completed.'
          : null;

  const edit = (payment: DebtPayment) => {
    setEditingPayment(payment);
    setAmount(amountInput(payment.amount));
    setNotes(payment.notes ?? '');
    setPaymentDate(payment.paymentDate);
    setQueuedAttachments([]);
    saveMutation.reset();
  };

  return (
    <dialog
      aria-labelledby="debt-payment-history-title"
      className="expense-dialog payment-history-dialog debt-payment-dialog"
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
            <h2 id="debt-payment-history-title">{debt.name}</h2>
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

        <div className="debt-balance-panel">
          <div>
            <span>Original</span>
            <strong>
              {formatMoney(
                currentDebt.originalAmount,
                currentDebt.currencyCode,
              )}
            </strong>
          </div>
          <div>
            <span>Recorded</span>
            <strong>
              {formatMoney(currentDebt.paidAmount, currentDebt.currencyCode)}
            </strong>
          </div>
          <div>
            <span>Remaining</span>
            <strong>
              {formatMoney(
                currentDebt.remainingAmount,
                currentDebt.currencyCode,
              )}
            </strong>
          </div>
        </div>

        {canRecord || editingPayment ? (
          <form
            className="record-payment debt-record-payment"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
          >
            <div className="debt-record-payment__heading">
              <p>{editingPayment ? 'Edit payment' : 'Record a payment'}</p>
              <strong>
                {editingPayment
                  ? formatExpenseDate(editingPayment.paymentDate)
                  : `${formatMoney(
                      currentDebt.remainingAmount,
                      currentDebt.currencyCode,
                    )} remaining`}
              </strong>
            </div>
            <label className="form-field" htmlFor="debt-payment-date">
              <span className="form-field__label">Payment date</span>
              <input
                className="form-field__input"
                id="debt-payment-date"
                onChange={(event) => setPaymentDate(event.target.value)}
                required
                type="date"
                value={paymentDate}
              />
            </label>
            <label className="form-field" htmlFor="debt-payment-amount">
              <span className="form-field__label">Amount</span>
              <input
                className="form-field__input"
                id="debt-payment-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                pattern="^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$"
                placeholder="0.00"
                required
                value={amount}
              />
            </label>
            <label
              className="form-field debt-payment-notes"
              htmlFor="debt-payment-notes"
            >
              <span className="form-field__label">Note (optional)</span>
              <input
                className="form-field__input"
                id="debt-payment-notes"
                maxLength={1000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Reference or payment detail"
                value={notes}
              />
            </label>
            <div className="debt-record-payment__actions">
              {editingPayment ? (
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setEditingPayment(null);
                    setAmount('');
                    setNotes('');
                    setPaymentDate(todayDate());
                    setQueuedAttachments([]);
                  }}
                  type="button"
                >
                  Cancel edit
                </button>
              ) : null}
              <button
                className="button button--primary"
                disabled={saveMutation.isPending}
                type="submit"
              >
                <Check aria-hidden="true" size={16} />
                {saveMutation.isPending
                  ? 'Saving…'
                  : editingPayment
                    ? 'Save payment'
                    : 'Record payment'}
              </button>
            </div>
            <div className="debt-payment-attachments">
              <AttachmentPanel
                entityId={editingPayment?.id ?? null}
                entityType="debt_payment"
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
            </div>
          </form>
        ) : (
          <p className="payment-history__notice">
            Reopen or resume this record to add another payment.
          </p>
        )}

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
            <History aria-hidden="true" size={20} />
            <strong>No recorded payments yet.</strong>
            <span>Partial and full payments will appear here.</span>
          </div>
        ) : (
          <ol className="payment-list debt-payment-list">
            {payments.map((payment) => (
              <li key={payment.id}>
                <div>
                  <strong>
                    {formatMoney(payment.amount, payment.currencyCode)}
                  </strong>
                  <span>
                    Paid {formatExpenseDate(payment.paymentDate)}
                    {payment.notes ? ` · ${payment.notes}` : ''}
                  </span>
                </div>
                <div className="debt-payment-list__actions">
                  {payment.attachmentCount > 0 ? (
                    <span
                      className="attachment-count"
                      title={`${payment.attachmentCount} attachment`}
                    >
                      <Paperclip aria-hidden="true" size={13} />
                      {payment.attachmentCount}
                    </span>
                  ) : null}
                  <button
                    aria-label={`Edit payment from ${formatExpenseDate(
                      payment.paymentDate,
                    )}`}
                    className="icon-button"
                    onClick={() => edit(payment)}
                    title="Edit payment"
                    type="button"
                  >
                    <Edit3 aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`Delete payment from ${formatExpenseDate(
                      payment.paymentDate,
                    )}`}
                    className="icon-button debt-payment-delete"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (
                        globalThis.confirm(
                          `Delete the ${formatMoney(
                            payment.amount,
                            payment.currencyCode,
                          )} payment from ${formatExpenseDate(
                            payment.paymentDate,
                          )}? Its attached proof will also be removed.`,
                        )
                      ) {
                        deleteMutation.mutate(payment.id);
                      }
                    }}
                    title="Delete payment"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={() => void paymentsQuery.refetch()}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={15} />
            Refresh
          </button>
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
