import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Edit3,
  History,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/client';
import { AttachmentCount } from '../components/AttachmentCount';
import { MonthNavigator } from '../components/MonthNavigator';
import { monthDateRange } from '../components/month';
import { expenseApi } from '../api/expenses';
import {
  subscriptionApi,
  type Subscription,
  type SubscriptionSort,
  type SubscriptionStatus,
} from '../api/subscriptions';
import { ExpenseOptionIcon } from '../expenses/icons';
import { usePreferences } from '../preferences/context';
import { PaymentHistoryDialog } from '../subscriptions/PaymentHistoryDialog';
import { SubscriptionFormDialog } from '../subscriptions/SubscriptionFormDialog';

const statusLabels: Record<SubscriptionStatus, string> = {
  active: 'Active',
  cancelled: 'Cancelled',
  ended: 'Ended',
  paused: 'Paused',
};

const frequencyLabels: Record<Subscription['billingFrequency'], string> = {
  custom: 'Custom',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semiannual: 'Every 6 months',
  weekly: 'Weekly',
  yearly: 'Yearly',
};

const sortLabels: Record<SubscriptionSort, string> = {
  amount_desc: 'Highest amount',
  next_asc: 'Next payment',
  next_desc: 'Latest payment date',
  updated_desc: 'Recently updated',
};

function categoryStyle(color: string): CSSProperties {
  return {
    '--category-color': color,
  } as CSSProperties;
}

function dueLabel(subscription: Subscription, today: string): string {
  if (subscription.status !== 'active') {
    return statusLabels[subscription.status];
  }
  const days = Math.round(
    (new Date(`${subscription.nextPaymentDate}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
      86_400_000,
  );
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const {
    currentMonth,
    formatDate: formatExpenseDate,
    formatMoney,
    todayDate,
  } = usePreferences();
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonth());
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<SubscriptionSort>('next_asc');
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>(
    [undefined],
  );
  const [formSelection, setFormSelection] = useState<
    Subscription | null | undefined
  >(undefined);
  const [paymentSelection, setPaymentSelection] = useState<Subscription | null>(
    null,
  );
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
      categoryId: categoryId || undefined,
      cursor,
      ...selectedMonthRange,
      search: search || undefined,
      sort,
      status: status || undefined,
    };
  }, [categoryId, cursor, search, selectedMonth, sort, status]);
  const optionsQuery = useQuery({
    queryFn: () => expenseApi.getOptions(true),
    queryKey: ['expense-options', true],
  });
  const subscriptionsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => subscriptionApi.list(filters),
    queryKey: ['subscriptions', filters],
  });
  const upcomingQuery = useQuery({
    queryFn: () => subscriptionApi.listUpcoming(30, 8),
    queryKey: ['subscription-upcoming', todayDate()],
  });
  const remindersQuery = useQuery({
    queryFn: subscriptionApi.listReminders,
    queryKey: ['subscription-reminders'],
  });

  const invalidateSubscriptions = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
      queryClient.invalidateQueries({ queryKey: ['subscription-upcoming'] }),
      queryClient.invalidateQueries({ queryKey: ['subscription-reminders'] }),
      queryClient.invalidateQueries({ queryKey: ['subscription-payments'] }),
    ]);
  };
  const statusMutation = useMutation({
    mutationFn: ({
      action,
      id,
    }: {
      action: 'cancel' | 'pause' | 'resume';
      id: string;
    }) => subscriptionApi[action](id),
    onSuccess: invalidateSubscriptions,
  });
  const deleteMutation = useMutation({
    mutationFn: subscriptionApi.delete,
    onSuccess: invalidateSubscriptions,
  });
  const dismissMutation = useMutation({
    mutationFn: subscriptionApi.dismissReminder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['subscription-reminders'],
      });
    },
  });

  const subscriptions = subscriptionsQuery.data?.items ?? [];
  const reminders = remindersQuery.data ?? [];
  const activeOnPage = subscriptions.filter(
    (subscription) => subscription.status === 'active',
  ).length;
  const hasFilters = Boolean(search || status || categoryId);
  const mutationError =
    statusMutation.error instanceof ApiError
      ? statusMutation.error.message
      : deleteMutation.error instanceof ApiError
        ? deleteMutation.error.message
        : null;

  return (
    <div className="subscriptions-page">
      <div className="page-heading expense-page-heading">
        <div>
          <p className="page-heading__context">Recurring payments</p>
          <h1>Subscriptions</h1>
          <p className="page-heading__description">
            See what renews next, record payments, and decide when an expense
            should be created.
          </p>
        </div>
        <div className="expense-heading-controls">
          <MonthNavigator
            ariaLabel="Subscription month"
            month={selectedMonth}
            onChange={(month) => {
              setSelectedMonth(month);
              setCursorHistory([undefined]);
            }}
          />
          <div className="page-heading__actions">
            <button
              className="button button--primary"
              disabled={!optionsQuery.data}
              onClick={() => setFormSelection(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add subscription
            </button>
          </div>
        </div>
      </div>

      {reminders.length > 0 ? (
        <section
          aria-labelledby="subscription-reminders-title"
          className="subscription-reminders"
        >
          <div className="subscription-reminders__heading">
            <span>
              <Bell aria-hidden="true" size={18} />
              <strong id="subscription-reminders-title">
                Payment reminders
              </strong>
            </span>
            <small>{reminders.length} need attention</small>
          </div>
          <div className="subscription-reminders__list">
            {reminders.map((reminder) => (
              <article key={reminder.id}>
                <div>
                  <strong>{reminder.name}</strong>
                  <span>
                    {formatMoney(reminder.amount, reminder.currencyCode)} · due{' '}
                    {formatExpenseDate(reminder.paymentDate)}
                  </span>
                </div>
                <div>
                  <button
                    className="button button--secondary button--small"
                    onClick={() => {
                      const subscription = subscriptions.find(
                        (item) => item.id === reminder.subscriptionId,
                      );
                      if (subscription) {
                        setPaymentSelection(subscription);
                      } else {
                        void queryClient
                          .fetchQuery({
                            queryFn: () =>
                              subscriptionApi.get(reminder.subscriptionId),
                            queryKey: ['subscription', reminder.subscriptionId],
                          })
                          .then(setPaymentSelection)
                          .catch(() => undefined);
                      }
                    }}
                    type="button"
                  >
                    Record payment
                  </button>
                  <button
                    aria-label={`Dismiss ${reminder.name} reminder`}
                    className="icon-button"
                    onClick={() => dismissMutation.mutate(reminder.id)}
                    title="Dismiss"
                    type="button"
                  >
                    <XCircle aria-hidden="true" size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="subscription-summary-title"
        className="subscription-summary"
      >
        <h2 className="sr-only" id="subscription-summary-title">
          Subscription summary
        </h2>
        <article>
          <span className="subscription-summary__icon">
            <CalendarClock aria-hidden="true" size={18} />
          </span>
          <div>
            <p>Due in 30 days</p>
            <strong>{upcomingQuery.data?.dueSoonCount ?? '—'}</strong>
            <span>Active renewals</span>
          </div>
        </article>
        <article>
          <span className="subscription-summary__icon subscription-summary__icon--danger">
            <Bell aria-hidden="true" size={18} />
          </span>
          <div>
            <p>Overdue</p>
            <strong>{upcomingQuery.data?.overdueCount ?? '—'}</strong>
            <span>Payments to review</span>
          </div>
        </article>
        <article>
          <span className="subscription-summary__icon subscription-summary__icon--neutral">
            <Play aria-hidden="true" size={18} />
          </span>
          <div>
            <p>Active on this page</p>
            <strong>{activeOnPage}</strong>
            <span>Filtered result</span>
          </div>
        </article>
      </section>

      <section
        aria-label="Subscription search and filters"
        className="expense-toolbar subscription-toolbar"
      >
        <label className="expense-search">
          <span className="sr-only">Search subscriptions</span>
          <Search aria-hidden="true" size={17} />
          <input
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search name or notes"
            type="search"
            value={searchText}
          />
        </label>
        <label>
          <span className="sr-only">Subscription status</span>
          <select
            aria-label="Filter by subscription status"
            onChange={(event) => {
              setStatus(event.target.value as SubscriptionStatus | '');
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
          <span className="sr-only">Subscription category</span>
          <select
            aria-label="Filter by subscription category"
            onChange={(event) => {
              setCategoryId(event.target.value);
              setCursorHistory([undefined]);
            }}
            value={categoryId}
          >
            <option value="">All categories</option>
            {optionsQuery.data?.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort subscriptions</span>
          <select
            aria-label="Sort subscriptions"
            onChange={(event) => {
              setSort(event.target.value as SubscriptionSort);
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
      </section>

      {subscriptionsQuery.isPending || optionsQuery.isPending ? (
        <section className="expense-state" role="status">
          <h2>Loading subscriptions…</h2>
          <p>Only this page of records is being requested.</p>
        </section>
      ) : subscriptionsQuery.isError || optionsQuery.isError ? (
        <section className="expense-state expense-state--error" role="alert">
          <h2>Subscriptions could not be loaded.</h2>
          <p>Refresh the page or try again in a moment.</p>
          <button
            className="button button--secondary"
            onClick={() => {
              void Promise.all([
                subscriptionsQuery.refetch(),
                optionsQuery.refetch(),
              ]);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      ) : subscriptions.length === 0 ? (
        <section className="expense-state">
          <span aria-hidden="true" className="expense-state__mark">
            <CalendarClock size={22} />
          </span>
          <p>{hasFilters ? 'No matches' : 'Nothing recurring yet'}</p>
          <h2>
            {hasFilters
              ? 'No subscriptions match these filters.'
              : 'Add your first subscription when you are ready.'}
          </h2>
          <span>
            {hasFilters
              ? 'Change a category, status, or search term.'
              : 'Upcoming renewals will stay visible without creating expenses automatically.'}
          </span>
          <button
            className="button button--primary"
            onClick={() => {
              if (hasFilters) {
                setSearch('');
                setSearchText('');
                setStatus('');
                setCategoryId('');
              } else {
                setFormSelection(null);
              }
            }}
            type="button"
          >
            {hasFilters ? 'Clear filters' : 'Add subscription'}
          </button>
        </section>
      ) : (
        <>
          <div className="expense-table-wrap">
            <table className="expense-table subscription-table">
              <caption className="sr-only">
                Subscriptions, page {cursorHistory.length}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Subscription</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Next payment</th>
                  <th scope="col">Status</th>
                  <th className="expense-table__amount" scope="col">
                    Amount
                  </th>
                  <th className="expense-table__actions" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td>
                      <strong>{subscription.name}</strong>
                      <span>
                        <i
                          className="subscription-category-dot"
                          style={categoryStyle(subscription.category.color)}
                        >
                          <ExpenseOptionIcon
                            name={subscription.category.icon}
                            size={13}
                          />
                        </i>
                        {subscription.category.name}
                        <AttachmentCount count={subscription.attachmentCount} />
                      </span>
                    </td>
                    <td>
                      {subscription.billingFrequency === 'custom'
                        ? `Every ${subscription.customIntervalDays} days`
                        : frequencyLabels[subscription.billingFrequency]}
                    </td>
                    <td>
                      <strong className="subscription-due">
                        {formatExpenseDate(subscription.nextPaymentDate)}
                      </strong>
                      <span>{dueLabel(subscription, todayDate())}</span>
                    </td>
                    <td>
                      <span
                        className={`subscription-status subscription-status--${subscription.status}`}
                      >
                        {statusLabels[subscription.status]}
                      </span>
                      {!subscription.autoRenew ? (
                        <small className="subscription-no-renew">
                          Final renewal
                        </small>
                      ) : null}
                    </td>
                    <td className="expense-table__amount">
                      {formatMoney(
                        subscription.amount,
                        subscription.currencyCode,
                      )}
                    </td>
                    <td>
                      <SubscriptionActions
                        busy={
                          statusMutation.isPending || deleteMutation.isPending
                        }
                        onCancel={() => {
                          if (
                            globalThis.confirm(
                              `Cancel “${subscription.name}”? Its payment history will remain available.`,
                            )
                          ) {
                            statusMutation.mutate({
                              action: 'cancel',
                              id: subscription.id,
                            });
                          }
                        }}
                        onDelete={() => {
                          if (
                            globalThis.confirm(
                              `Delete “${subscription.name}”? Its subscription record and stored files will be removed.`,
                            )
                          ) {
                            deleteMutation.mutate(subscription.id);
                          }
                        }}
                        onEdit={() => setFormSelection(subscription)}
                        onHistory={() => setPaymentSelection(subscription)}
                        onPause={() =>
                          statusMutation.mutate({
                            action: 'pause',
                            id: subscription.id,
                          })
                        }
                        onResume={() =>
                          statusMutation.mutate({
                            action: 'resume',
                            id: subscription.id,
                          })
                        }
                        subscription={subscription}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="expense-cards subscription-cards">
            {subscriptions.map((subscription) => (
              <article
                className="expense-card subscription-card"
                key={subscription.id}
              >
                <div className="subscription-card__top">
                  <span
                    className="expense-card__icon"
                    style={categoryStyle(subscription.category.color)}
                  >
                    <ExpenseOptionIcon name={subscription.category.icon} />
                  </span>
                  <div>
                    <strong>{subscription.name}</strong>
                    <span>
                      {subscription.category.name} ·{' '}
                      {frequencyLabels[subscription.billingFrequency]}
                      <AttachmentCount count={subscription.attachmentCount} />
                    </span>
                  </div>
                  <b>
                    {formatMoney(
                      subscription.amount,
                      subscription.currencyCode,
                    )}
                  </b>
                </div>
                <div className="subscription-card__due">
                  <span>
                    Next {formatExpenseDate(subscription.nextPaymentDate)}
                  </span>
                  <strong>{dueLabel(subscription, todayDate())}</strong>
                </div>
                <div className="expense-card__footer">
                  <span
                    className={`subscription-status subscription-status--${subscription.status}`}
                  >
                    {statusLabels[subscription.status]}
                  </span>
                  <SubscriptionActions
                    busy={statusMutation.isPending || deleteMutation.isPending}
                    onCancel={() =>
                      globalThis.confirm(
                        `Cancel “${subscription.name}”? Its payment history will remain available.`,
                      )
                        ? statusMutation.mutate({
                            action: 'cancel',
                            id: subscription.id,
                          })
                        : undefined
                    }
                    onDelete={() =>
                      globalThis.confirm(
                        `Delete “${subscription.name}”? Its subscription record and stored files will be removed.`,
                      )
                        ? deleteMutation.mutate(subscription.id)
                        : undefined
                    }
                    onEdit={() => setFormSelection(subscription)}
                    onHistory={() => setPaymentSelection(subscription)}
                    onPause={() =>
                      statusMutation.mutate({
                        action: 'pause',
                        id: subscription.id,
                      })
                    }
                    onResume={() =>
                      statusMutation.mutate({
                        action: 'resume',
                        id: subscription.id,
                      })
                    }
                    subscription={subscription}
                  />
                </div>
              </article>
            ))}
          </div>

          <nav aria-label="Subscription pages" className="pagination">
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
              disabled={!subscriptionsQuery.data?.nextCursor}
              onClick={() => {
                const nextCursor = subscriptionsQuery.data?.nextCursor;
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

      {mutationError ? (
        <p className="form-message form-message--error" role="alert">
          {mutationError}
        </p>
      ) : null}

      {optionsQuery.data ? (
        <>
          <SubscriptionFormDialog
            onClose={() => setFormSelection(undefined)}
            open={formSelection !== undefined}
            options={optionsQuery.data}
            subscription={formSelection ?? null}
          />
          <PaymentHistoryDialog
            onClose={() => setPaymentSelection(null)}
            open={paymentSelection !== null}
            options={optionsQuery.data}
            subscription={paymentSelection}
          />
        </>
      ) : null}
    </div>
  );
}

function SubscriptionActions({
  busy,
  onCancel,
  onDelete,
  onEdit,
  onHistory,
  onPause,
  onResume,
  subscription,
}: {
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onPause: () => void;
  onResume: () => void;
  subscription: Subscription;
}) {
  return (
    <div className="expense-actions subscription-actions">
      <button
        aria-label={`Payment history for ${subscription.name}`}
        disabled={busy}
        onClick={onHistory}
        title="Payment history"
        type="button"
      >
        <History aria-hidden="true" size={16} />
      </button>
      <button
        aria-label={`Edit ${subscription.name}`}
        disabled={busy}
        onClick={onEdit}
        title="Edit"
        type="button"
      >
        <Edit3 aria-hidden="true" size={16} />
      </button>
      {subscription.status === 'active' ? (
        <button
          aria-label={`Pause ${subscription.name}`}
          disabled={busy}
          onClick={onPause}
          title="Pause"
          type="button"
        >
          <Pause aria-hidden="true" size={16} />
        </button>
      ) : subscription.status === 'paused' ? (
        <button
          aria-label={`Resume ${subscription.name}`}
          disabled={busy}
          onClick={onResume}
          title="Resume"
          type="button"
        >
          <Play aria-hidden="true" size={16} />
        </button>
      ) : null}
      {['active', 'paused'].includes(subscription.status) ? (
        <button
          aria-label={`Cancel ${subscription.name}`}
          className="subscription-actions__cancel"
          disabled={busy}
          onClick={onCancel}
          title="Cancel"
          type="button"
        >
          <XCircle aria-hidden="true" size={16} />
        </button>
      ) : null}
      <button
        aria-label={`Delete ${subscription.name}`}
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
