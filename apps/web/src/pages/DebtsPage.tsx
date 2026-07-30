import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Edit3,
  HandCoins,
  History,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/client';
import { AttachmentCount } from '../components/AttachmentCount';
import { MonthNavigator } from '../components/MonthNavigator';
import { monthDateRange } from '../components/month';
import {
  debtApi,
  type Debt,
  type DebtDirection,
  type DebtSort,
  type DebtStatus,
} from '../api/debts';
import { DebtFormDialog } from '../debts/DebtFormDialog';
import { DebtPaymentHistoryDialog } from '../debts/DebtPaymentHistoryDialog';
import { usePreferences } from '../preferences/context';

const statusLabels: Record<DebtStatus, string> = {
  active: 'Active',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
  paid: 'Paid',
  paused: 'Paused',
};
const sortLabels: Record<DebtSort, string> = {
  amount_desc: 'Highest remaining',
  due_asc: 'Due soonest',
  updated_desc: 'Recently updated',
};

function dueLabel(
  debt: Debt,
  today: string,
  formatDate: (value: string) => string,
): string {
  if (debt.status === 'paid') return 'Fully paid';
  if (debt.status === 'paused') return 'Payments paused';
  if (debt.status === 'cancelled') return 'Record cancelled';
  const due = debt.nextPaymentDate ?? debt.dueDate;
  if (!due) return 'No due date';
  const days = Math.round(
    (new Date(`${due}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
      86_400_000,
  );
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${formatDate(due)}`;
}

function directionCopy(direction: DebtDirection) {
  return direction === 'i_owe'
    ? {
        description:
          'Keep track of what you still need to repay, without accounting language.',
        empty: 'Add the first amount you owe when you are ready.',
        tab: 'Money I owe',
      }
    : {
        description:
          'Follow money expected back from people, customers, or companies.',
        empty: 'Add the first amount owed to you when you are ready.',
        tab: 'Money owed to me',
      };
}

export function DebtsPage() {
  const queryClient = useQueryClient();
  const {
    currentMonth,
    formatDate: formatExpenseDate,
    formatMoney,
    todayDate,
  } = usePreferences();
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonth());
  const [direction, setDirection] = useState<DebtDirection>('i_owe');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DebtSort>('due_asc');
  const [status, setStatus] = useState<DebtStatus | ''>('');
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>(
    [undefined],
  );
  const [formSelection, setFormSelection] = useState<Debt | null | undefined>(
    undefined,
  );
  const [paymentSelection, setPaymentSelection] = useState<Debt | null>(null);
  const cursor = cursorHistory.at(-1);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      setSearch(searchText.trim());
      setCursorHistory([undefined]);
    }, 300);
    return () => globalThis.clearTimeout(timeout);
  }, [searchText]);

  const filters = useMemo(() => {
    const selectedMonthRange = monthDateRange(selectedMonth);
    return {
      cursor,
      ...selectedMonthRange,
      direction,
      search: search || undefined,
      sort,
      status: status || undefined,
    };
  }, [cursor, direction, search, selectedMonth, sort, status]);
  const debtsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => debtApi.list(filters),
    queryKey: ['debts', filters],
  });
  const summaryQuery = useQuery({
    queryFn: debtApi.getSummary,
    queryKey: ['debt-summary'],
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['debts'] }),
      queryClient.invalidateQueries({ queryKey: ['debt-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['debt-upcoming'] }),
      queryClient.invalidateQueries({ queryKey: ['debt-payments'] }),
    ]);
  };
  const statusMutation = useMutation({
    mutationFn: ({
      action,
      id,
    }: {
      action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume';
      id: string;
    }) => debtApi[action](id),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: debtApi.delete,
    onSuccess: invalidate,
  });

  const debts = debtsQuery.data?.items ?? [];
  const copy = directionCopy(direction);
  const hasFilters = Boolean(search || status);
  const error =
    statusMutation.error instanceof ApiError
      ? statusMutation.error.message
      : deleteMutation.error instanceof ApiError
        ? deleteMutation.error.message
        : null;

  const selectDirection = (nextDirection: DebtDirection) => {
    setDirection(nextDirection);
    setCursorHistory([undefined]);
    setStatus('');
  };

  return (
    <div className="debts-page">
      <div className="page-heading expense-page-heading">
        <div>
          <p className="page-heading__context">Loans and debts</p>
          <h1>Money owed</h1>
          <p className="page-heading__description">{copy.description}</p>
        </div>
        <div className="expense-heading-controls">
          <MonthNavigator
            ariaLabel="Loans and debts month"
            month={selectedMonth}
            onChange={(month) => {
              setSelectedMonth(month);
              setCursorHistory([undefined]);
            }}
          />
          <div className="page-heading__actions">
            <button
              className="button button--primary"
              onClick={() => setFormSelection(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add loan or debt
            </button>
          </div>
        </div>
      </div>

      <div
        aria-label="Money owed direction"
        className="debt-tabs"
        role="tablist"
      >
        <button
          aria-selected={direction === 'i_owe'}
          onClick={() => selectDirection('i_owe')}
          role="tab"
          type="button"
        >
          <WalletCards aria-hidden="true" size={17} />
          Money I owe
        </button>
        <button
          aria-selected={direction === 'owed_to_me'}
          onClick={() => selectDirection('owed_to_me')}
          role="tab"
          type="button"
        >
          <HandCoins aria-hidden="true" size={17} />
          Money owed to me
        </button>
      </div>

      <section
        aria-label="Debt totals"
        className="subscription-summary debt-summary"
      >
        <article>
          <span className="subscription-summary__icon subscription-summary__icon--danger">
            <WalletCards aria-hidden="true" size={19} />
          </span>
          <div>
            <p>Money I owe</p>
            {summaryQuery.data ? (
              <span className="multi-currency-totals">
                {summaryQuery.data.currencyGroups.map((group) => (
                  <strong key={group.currencyCode}>
                    {formatMoney(group.iOwe, group.currencyCode)}
                  </strong>
                ))}
              </span>
            ) : (
              <strong>—</strong>
            )}
            <span>Still remaining</span>
          </div>
        </article>
        <article>
          <span className="subscription-summary__icon">
            <HandCoins aria-hidden="true" size={19} />
          </span>
          <div>
            <p>Money owed to me</p>
            {summaryQuery.data ? (
              <span className="multi-currency-totals">
                {summaryQuery.data.currencyGroups.map((group) => (
                  <strong key={group.currencyCode}>
                    {formatMoney(group.owedToMe, group.currencyCode)}
                  </strong>
                ))}
              </span>
            ) : (
              <strong>—</strong>
            )}
            <span>Still expected</span>
          </div>
        </article>
        <article>
          <span className="subscription-summary__icon subscription-summary__icon--neutral">
            <CircleDollarSign aria-hidden="true" size={19} />
          </span>
          <div>
            <p>{copy.tab}</p>
            <strong>{debts.length}</strong>
            <span>On this page</span>
          </div>
        </article>
      </section>

      <div className="expense-toolbar debt-toolbar">
        <label className="expense-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="Search loans and debts"
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search names or notes"
            value={searchText}
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select
            aria-label="Filter by status"
            onChange={(event) => {
              setStatus(event.target.value as DebtStatus | '');
              setCursorHistory([undefined]);
            }}
            value={status}
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <select
            aria-label="Sort loans and debts"
            onChange={(event) => {
              setSort(event.target.value as DebtSort);
              setCursorHistory([undefined]);
            }}
            value={sort}
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {debtsQuery.isPending ? (
        <div className="expense-state" role="status">
          <span className="expense-state__mark">
            <RotateCcw aria-hidden="true" size={20} />
          </span>
          <h2>Loading {copy.tab.toLowerCase()}…</h2>
        </div>
      ) : debtsQuery.isError ? (
        <div className="expense-state" role="alert">
          <span className="expense-state__mark">
            <Ban aria-hidden="true" size={20} />
          </span>
          <h2>Loans and debts could not be loaded.</h2>
          <button
            className="button button--secondary"
            onClick={() => void debtsQuery.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : debts.length === 0 ? (
        <div className="expense-state">
          <span className="expense-state__mark">
            {direction === 'i_owe' ? (
              <WalletCards aria-hidden="true" size={20} />
            ) : (
              <HandCoins aria-hidden="true" size={20} />
            )}
          </span>
          <p>{hasFilters ? 'No matches' : copy.tab}</p>
          <h2>{hasFilters ? 'No records match these filters.' : copy.empty}</h2>
          <span>Partial payments and the remaining balance stay together.</span>
          {!hasFilters ? (
            <button
              className="button button--primary"
              onClick={() => setFormSelection(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add loan or debt
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="expense-table-wrap debt-table-wrap">
            <table className="expense-table debt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Original</th>
                  <th>Remaining</th>
                  <th>Next due</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {debts.map((debt) => (
                  <tr key={debt.id}>
                    <td>
                      <strong>{debt.name}</strong>
                      <span>
                        Started {formatExpenseDate(debt.startDate)}
                        <AttachmentCount count={debt.attachmentCount} />
                      </span>
                    </td>
                    <td>
                      {formatMoney(debt.originalAmount, debt.currencyCode)}
                    </td>
                    <td className="debt-remaining">
                      <strong>
                        {formatMoney(debt.remainingAmount, debt.currencyCode)}
                      </strong>
                      <span>
                        {formatMoney(debt.paidAmount, debt.currencyCode)}{' '}
                        recorded
                      </span>
                    </td>
                    <td>
                      <strong className="subscription-due">
                        {dueLabel(debt, todayDate(), formatExpenseDate)}
                      </strong>
                      {debt.installmentAmount ? (
                        <span>
                          {formatMoney(
                            debt.installmentAmount,
                            debt.currencyCode,
                          )}{' '}
                          installments
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`subscription-status debt-status--${debt.status}`}
                      >
                        {statusLabels[debt.status]}
                      </span>
                    </td>
                    <td>
                      <DebtActions
                        busy={
                          statusMutation.isPending || deleteMutation.isPending
                        }
                        debt={debt}
                        onAction={(action) => {
                          if (
                            action === 'complete' &&
                            Number(debt.remainingAmount) > 0 &&
                            !globalThis.confirm(
                              `Mark “${debt.name}” as fully paid with ${formatMoney(
                                debt.remainingAmount,
                                debt.currencyCode,
                              )} still unrecorded? This does not create a payment.`,
                            )
                          ) {
                            return;
                          }
                          if (
                            action === 'cancel' &&
                            !globalThis.confirm(
                              `Cancel “${debt.name}”? Its payment history will remain available.`,
                            )
                          ) {
                            return;
                          }
                          statusMutation.mutate({ action, id: debt.id });
                        }}
                        onDelete={() => {
                          if (
                            globalThis.confirm(
                              `Delete “${debt.name}”? Its payments and stored files will also be removed.`,
                            )
                          ) {
                            deleteMutation.mutate(debt.id);
                          }
                        }}
                        onEdit={() => setFormSelection(debt)}
                        onHistory={() => setPaymentSelection(debt)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="expense-cards debt-cards">
            {debts.map((debt) => (
              <article className="expense-card debt-card" key={debt.id}>
                <div className="subscription-card__top">
                  <span className="expense-card__icon">
                    {debt.direction === 'i_owe' ? (
                      <WalletCards aria-hidden="true" size={18} />
                    ) : (
                      <HandCoins aria-hidden="true" size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{debt.name}</strong>
                    <span>
                      {dueLabel(debt, todayDate(), formatExpenseDate)}
                      <AttachmentCount count={debt.attachmentCount} />
                    </span>
                  </div>
                  <b>{formatMoney(debt.remainingAmount, debt.currencyCode)}</b>
                </div>
                <div className="subscription-card__due">
                  <span>{statusLabels[debt.status]}</span>
                  <strong>
                    {formatMoney(debt.paidAmount, debt.currencyCode)} recorded
                  </strong>
                </div>
                <DebtActions
                  busy={statusMutation.isPending || deleteMutation.isPending}
                  debt={debt}
                  onAction={(action) =>
                    statusMutation.mutate({ action, id: debt.id })
                  }
                  onDelete={() =>
                    globalThis.confirm(`Delete “${debt.name}”?`)
                      ? deleteMutation.mutate(debt.id)
                      : undefined
                  }
                  onEdit={() => setFormSelection(debt)}
                  onHistory={() => setPaymentSelection(debt)}
                />
              </article>
            ))}
          </div>

          <nav aria-label="Loans and debts pages" className="pagination">
            <button
              className="button button--secondary"
              disabled={cursorHistory.length === 1}
              onClick={() =>
                setCursorHistory((history) => history.slice(0, -1))
              }
              type="button"
            >
              Previous
            </button>
            <span>Page {cursorHistory.length}</span>
            <button
              className="button button--secondary"
              disabled={!debtsQuery.data?.nextCursor}
              onClick={() => {
                const nextCursor = debtsQuery.data?.nextCursor;
                if (nextCursor) {
                  setCursorHistory((history) => [...history, nextCursor]);
                }
              }}
              type="button"
            >
              Next
            </button>
          </nav>
        </>
      )}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}

      <DebtFormDialog
        debt={formSelection ?? null}
        direction={direction}
        onClose={() => setFormSelection(undefined)}
        open={formSelection !== undefined}
      />
      <DebtPaymentHistoryDialog
        debt={paymentSelection}
        onClose={() => setPaymentSelection(null)}
        open={paymentSelection !== null}
      />
    </div>
  );
}

function DebtActions({
  busy,
  debt,
  onAction,
  onDelete,
  onEdit,
  onHistory,
}: {
  busy: boolean;
  debt: Debt;
  onAction: (
    action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume',
  ) => void;
  onDelete: () => void;
  onEdit: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="expense-actions subscription-actions debt-actions">
      <button
        aria-label={`Payment history for ${debt.name}`}
        disabled={busy}
        onClick={onHistory}
        title="Payments"
        type="button"
      >
        <History aria-hidden="true" size={16} />
      </button>
      <button
        aria-label={`Edit ${debt.name}`}
        disabled={busy}
        onClick={onEdit}
        title="Edit"
        type="button"
      >
        <Edit3 aria-hidden="true" size={16} />
      </button>
      {['active', 'overdue'].includes(debt.status) ? (
        <>
          <button
            aria-label={`Mark ${debt.name} fully paid`}
            disabled={busy}
            onClick={() => onAction('complete')}
            title="Mark fully paid"
            type="button"
          >
            <CheckCircle2 aria-hidden="true" size={16} />
          </button>
          <button
            aria-label={`Pause ${debt.name}`}
            disabled={busy}
            onClick={() => onAction('pause')}
            title="Pause"
            type="button"
          >
            <Pause aria-hidden="true" size={16} />
          </button>
        </>
      ) : debt.status === 'paused' ? (
        <button
          aria-label={`Resume ${debt.name}`}
          disabled={busy}
          onClick={() => onAction('resume')}
          title="Resume"
          type="button"
        >
          <Play aria-hidden="true" size={16} />
        </button>
      ) : debt.status === 'paid' ? (
        <button
          aria-label={`Reopen ${debt.name}`}
          disabled={busy}
          onClick={() => onAction('reopen')}
          title="Reopen"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
        </button>
      ) : null}
      {['active', 'overdue', 'paused'].includes(debt.status) ? (
        <button
          aria-label={`Cancel ${debt.name}`}
          className="subscription-actions__cancel"
          disabled={busy}
          onClick={() => onAction('cancel')}
          title="Cancel"
          type="button"
        >
          <Ban aria-hidden="true" size={16} />
        </button>
      ) : null}
      <button
        aria-label={`Delete ${debt.name}`}
        className="expense-actions__danger"
        disabled={busy}
        onClick={onDelete}
        title="Delete"
        type="button"
      >
        <Trash2 aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
