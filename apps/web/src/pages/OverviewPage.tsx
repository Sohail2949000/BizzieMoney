import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  HandCoins,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { backupApi } from '../api/backups';
import { debtApi } from '../api/debts';
import { expenseApi } from '../api/expenses';
import { subscriptionApi } from '../api/subscriptions';
import { useAuth } from '../auth/auth';
import { usePreferences } from '../preferences/context';

const clarityItems = [
  {
    icon: ReceiptText,
    label: 'Spent this month',
    tone: 'danger',
  },
  {
    icon: Clock3,
    label: 'Subscriptions due soon',
    tone: 'info',
  },
  {
    icon: WalletCards,
    label: 'Money I owe',
    tone: 'warning',
  },
  {
    icon: HandCoins,
    label: 'Money owed to me',
    tone: 'success',
  },
] as const;

const startingPoints = [
  {
    description: 'Keep everyday spending searchable and tidy.',
    label: 'Track an expense',
    path: '/expenses',
  },
  {
    description: 'See renewals before they surprise you.',
    label: 'List a subscription',
    path: '/subscriptions',
  },
  {
    description: 'Follow payments without accounting language.',
    label: 'Add money owed',
    path: '/debts',
  },
] as const;

export function OverviewPage() {
  const { owner } = useAuth();
  const {
    currentMonth,
    formatDate: formatExpenseDate,
    formatDateTime,
    formatMoney,
    todayDate,
  } = usePreferences();
  const summaryQuery = useQuery({
    queryFn: () => expenseApi.getSummary(currentMonth()),
    queryKey: ['expense-summary', currentMonth()],
  });
  const upcomingSubscriptionsQuery = useQuery({
    queryFn: () => subscriptionApi.listUpcoming(30, 5),
    queryKey: ['subscription-upcoming', todayDate()],
  });
  const debtSummaryQuery = useQuery({
    queryFn: debtApi.getSummary,
    queryKey: ['debt-summary'],
  });
  const upcomingDebtsQuery = useQuery({
    queryFn: () => debtApi.listUpcoming(30, 5),
    queryKey: ['debt-upcoming', todayDate()],
  });
  const backupStatusQuery = useQuery({
    queryFn: backupApi.getStatus,
    queryKey: ['backup-status'],
    refetchInterval: 30_000,
  });
  const today = formatExpenseDate(todayDate());
  const expenseGroups = summaryQuery.data?.currencyGroups ?? [];
  const debtGroups = debtSummaryQuery.data?.currencyGroups ?? [];
  const upcomingItems = [
    ...(upcomingSubscriptionsQuery.data?.items ?? []).map((item) => ({
      ...item,
      dueDate: item.nextPaymentDate,
      type: 'Subscription' as const,
    })),
    ...(upcomingDebtsQuery.data?.items ?? []).map((item) => ({
      ...item,
      overdue: item.status === 'overdue',
      type:
        item.direction === 'i_owe'
          ? ('Money I owe' as const)
          : ('Money owed to me' as const),
    })),
  ]
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 5);

  return (
    <div className="overview-page">
      <div className="page-heading page-heading--overview">
        <div>
          <p className="page-heading__context">{today}</p>
          <h1>Overview</h1>
          <p className="page-heading__description">
            A clear home for spending, subscriptions, debts, and safe backups.
          </p>
        </div>
        <Link className="button button--primary" to="/expenses">
          Add an expense
          <ArrowRight aria-hidden="true" size={17} strokeWidth={1.9} />
        </Link>
      </div>

      <section aria-labelledby="welcome-title" className="welcome-panel">
        <div className="welcome-panel__copy">
          <span aria-hidden="true" className="welcome-panel__mark">
            B
          </span>
          <div>
            <p className="welcome-panel__eyebrow">A fresh start</p>
            <h2 id="welcome-title">Your money, minus the noise.</h2>
            <p>
              Welcome, {owner.displayName}. BizzieMoney will show what needs
              attention without asking you to learn accounting first.
            </p>
          </div>
        </div>
        <div className="welcome-panel__assurance">
          <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.7} />
          <span>
            <strong>Private by default</strong>
            <span>No public registration or tracking</span>
          </span>
        </div>
      </section>

      <section aria-labelledby="clarity-title" className="clarity-panel">
        <div className="section-heading">
          <div>
            <p className="section-heading__label">At a glance</p>
            <h2 id="clarity-title">The four numbers that matter first</h2>
          </div>
          <span className="section-heading__status">
            <CheckCircle2 aria-hidden="true" size={15} strokeWidth={1.9} />
            Ready when you are
          </span>
        </div>
        <div className="clarity-grid">
          {clarityItems.map(({ icon: Icon, label, tone }, index) => {
            const moneyValues =
              index === 0
                ? expenseGroups.map((group) =>
                    formatMoney(group.totalAmount, group.currencyCode),
                  )
                : index === 2
                  ? debtGroups.map((group) =>
                      formatMoney(group.iOwe, group.currencyCode),
                    )
                  : index === 3
                    ? debtGroups.map((group) =>
                        formatMoney(group.owedToMe, group.currencyCode),
                      )
                    : [];
            const primaryValue =
              index === 1 && upcomingSubscriptionsQuery.data
                ? String(upcomingSubscriptionsQuery.data.dueSoonCount)
                : (moneyValues[0] ?? '—');
            return (
              <article className="clarity-item" key={label}>
                <span
                  aria-hidden="true"
                  className={`clarity-item__icon clarity-item__icon--${tone}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <div>
                  <p>{label}</p>
                  <strong
                    aria-label={`${label}: ${
                      moneyValues.length > 0
                        ? moneyValues.join(', ')
                        : primaryValue
                    }`}
                  >
                    {primaryValue}
                  </strong>
                  {moneyValues.length > 1 ? (
                    <span className="clarity-item__secondary-values">
                      {moneyValues.slice(1).map((value) => (
                        <b key={value}>{value}</b>
                      ))}
                    </span>
                  ) : null}
                  <span>
                    {index === 0 && summaryQuery.data
                      ? `${summaryQuery.data.count} this month`
                      : index === 1 && upcomingSubscriptionsQuery.data
                        ? upcomingSubscriptionsQuery.data.overdueCount > 0
                          ? `${upcomingSubscriptionsQuery.data.overdueCount} overdue`
                          : 'Next 30 days'
                        : index === 2 && debtSummaryQuery.data
                          ? 'Still remaining'
                          : index === 3 && debtSummaryQuery.data
                            ? 'Still expected'
                            : 'No data yet'}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="spending-breakdown-title"
        className="overview-expenses"
      >
        <div className="section-heading">
          <div>
            <p className="section-heading__label">Spending this month</p>
            <h2 id="spending-breakdown-title">Where your money went</h2>
          </div>
          <Link className="text-link" to="/expenses">
            View all
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        </div>
        {summaryQuery.isPending ? (
          <p className="overview-expenses__empty" role="status">
            Loading expense summary…
          </p>
        ) : summaryQuery.isError ? (
          <p className="overview-expenses__empty" role="alert">
            Expense summary could not be loaded.
          </p>
        ) : summaryQuery.data.count === 0 ? (
          <div className="overview-expenses__empty">
            <strong>No expenses this month.</strong>
            <span>
              Your category breakdown will appear after the first one.
            </span>
          </div>
        ) : (
          <div className="overview-expenses__grid">
            <div className="category-bars">
              {summaryQuery.data.currencyGroups.map((group) => (
                <div className="currency-breakdown" key={group.currencyCode}>
                  {summaryQuery.data.currencyGroups.length > 1 ? (
                    <div className="currency-breakdown__heading">
                      <strong>{group.currencyCode}</strong>
                      <span>
                        {formatMoney(group.totalAmount, group.currencyCode)}
                      </span>
                    </div>
                  ) : null}
                  {group.categories.map((category) => {
                    const total = Number(group.totalAmount);
                    const width =
                      total === 0 ? 0 : (Number(category.amount) / total) * 100;
                    return (
                      <div
                        className="category-bar"
                        key={`${group.currencyCode}-${category.id}`}
                      >
                        <div>
                          <span>{category.name}</span>
                          <strong>
                            {formatMoney(category.amount, group.currencyCode)}
                          </strong>
                        </div>
                        <span className="category-bar__track">
                          <i
                            style={{
                              backgroundColor: category.color,
                              width: `${Math.max(width, 2)}%`,
                            }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="recent-expenses">
              <p>Recent expenses</p>
              {summaryQuery.data.recent.map((expense) => (
                <article key={expense.id}>
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: expense.category.color }}
                  />
                  <div>
                    <strong>{expense.description}</strong>
                    <span>{formatExpenseDate(expense.date)}</span>
                  </div>
                  <b>{formatMoney(expense.amount, expense.currencyCode)}</b>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section
        aria-labelledby="upcoming-payments-title"
        className="overview-upcoming"
      >
        <div className="section-heading">
          <div>
            <p className="section-heading__label">Upcoming payments</p>
            <h2 id="upcoming-payments-title">What is due next</h2>
          </div>
          <Link className="text-link" to="/debts">
            View money owed
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        </div>
        {upcomingSubscriptionsQuery.isPending ||
        upcomingDebtsQuery.isPending ? (
          <p className="overview-expenses__empty" role="status">
            Loading upcoming payments…
          </p>
        ) : upcomingSubscriptionsQuery.isError || upcomingDebtsQuery.isError ? (
          <p className="overview-expenses__empty" role="alert">
            Upcoming payments could not be loaded.
          </p>
        ) : upcomingItems.length === 0 ? (
          <div className="overview-expenses__empty">
            <strong>No payments due in the next 30 days.</strong>
            <span>Subscription renewals and money owed will appear here.</span>
          </div>
        ) : (
          <div className="overview-upcoming__list">
            {upcomingItems.map((item) => (
              <article key={`${item.type}-${item.id}`}>
                <span
                  aria-hidden="true"
                  className={`status-dot ${
                    item.overdue ? 'status-dot--danger' : 'status-dot--warning'
                  }`}
                />
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.overdue
                      ? `${Math.abs(item.daysUntilDue)} day${
                          item.daysUntilDue === -1 ? '' : 's'
                        } overdue`
                      : item.daysUntilDue === 0
                        ? 'Due today'
                        : `Due ${formatExpenseDate(item.dueDate)}`}
                    {' · '}
                    {item.type}
                  </span>
                </div>
                <b>{formatMoney(item.amount, item.currencyCode)}</b>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="overview-columns">
        <section aria-labelledby="start-title" className="start-panel">
          <div className="section-heading">
            <div>
              <p className="section-heading__label">Start simple</p>
              <h2 id="start-title">Add only what helps</h2>
            </div>
          </div>
          <div className="start-list">
            {startingPoints.map((item, index) => (
              <Link className="start-list__item" key={item.path} to={item.path}>
                <span aria-hidden="true" className="start-list__number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="start-list__copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="start-list__arrow"
                  size={17}
                  strokeWidth={1.8}
                />
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="backup-title" className="backup-panel">
          <div className="section-heading">
            <div>
              <p className="section-heading__label">Data safety</p>
              <h2 id="backup-title">Backup status</h2>
            </div>
            <RotateCcw aria-hidden="true" size={19} strokeWidth={1.7} />
          </div>
          <div className="backup-panel__state">
            <span
              aria-hidden="true"
              className={`status-dot status-dot--${
                backupStatusQuery.data?.worker.status === 'offline'
                  ? 'danger'
                  : backupStatusQuery.data?.lastSuccessfulBackup
                    ? 'success'
                    : 'warning'
              }`}
            />
            <div>
              <strong>
                {backupStatusQuery.isPending
                  ? 'Checking backup safety'
                  : backupStatusQuery.data?.activeJob
                    ? backupStatusQuery.data.activeJob.progressStage
                    : backupStatusQuery.data?.lastSuccessfulBackup
                      ? 'Verified backup available'
                      : backupStatusQuery.data?.config?.enabled
                        ? 'First backup scheduled'
                        : 'Not configured'}
              </strong>
              <span>
                {backupStatusQuery.data?.activeJob
                  ? `${backupStatusQuery.data.activeJob.progressPercent}% complete`
                  : backupStatusQuery.data?.worker.status === 'offline'
                    ? 'The backup worker is not reporting. Check Docker.'
                    : backupStatusQuery.data?.lastSuccessfulBackup
                      ? 'The archive passed its stored checksum verification.'
                      : 'Choose a destination before adding important data.'}
              </span>
            </div>
          </div>
          <dl className="backup-details">
            <div>
              <dt>Last successful backup</dt>
              <dd>
                {backupStatusQuery.data?.lastSuccessfulBackup
                  ? formatDateTime(
                      backupStatusQuery.data.lastSuccessfulBackup
                        .backupCreatedAt,
                    )
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Next scheduled backup</dt>
              <dd>
                {backupStatusQuery.data?.config?.nextRunAt
                  ? formatDateTime(backupStatusQuery.data.config.nextRunAt)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>
                {backupStatusQuery.data?.config?.destination === 'local'
                  ? 'Local host folder'
                  : backupStatusQuery.data?.config?.destination === 's3'
                    ? 'S3 / R2'
                    : 'Not set'}
              </dd>
            </div>
          </dl>
          <Link className="text-link" to="/settings#backups">
            Review backup settings
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        </section>
      </div>
    </div>
  );
}
