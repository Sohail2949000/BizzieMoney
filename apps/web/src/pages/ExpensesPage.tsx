import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Copy,
  Download,
  Edit3,
  FileUp,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  expenseApi,
  type Expense,
  type ExpenseFilters,
  type ExpenseSort,
} from '../api/expenses';
import { ApiError } from '../api/client';
import { AttachmentCount } from '../components/AttachmentCount';
import { MonthNavigator } from '../components/MonthNavigator';
import { monthDateRange, monthLabel } from '../components/month';
import {
  ExpenseFormDialog,
  type ExpenseFormMode,
} from '../expenses/ExpenseFormDialog';
import { ExpenseOptionIcon } from '../expenses/icons';
import { usePreferences } from '../preferences/context';

const sortLabels: Record<ExpenseSort, string> = {
  amount_asc: 'Amount: low to high',
  amount_desc: 'Amount: high to low',
  date_asc: 'Date: oldest first',
  date_desc: 'Date: newest first',
  updated_desc: 'Recently updated',
};

const ExpenseImportDialog = lazy(() =>
  import('../expenses/ExpenseImportDialog').then((module) => ({
    default: module.ExpenseImportDialog,
  })),
);

function categoryStyle(color: string | undefined): CSSProperties {
  return { '--category-color': color ?? '#71717A' } as CSSProperties;
}

export function ExpensesPage() {
  const queryClient = useQueryClient();
  const {
    currentMonth,
    formatDate: formatExpenseDate,
    formatMoney,
    todayDate,
  } = usePreferences();
  const [summaryMonth, setSummaryMonth] = useState(() => currentMonth());
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [attachmentFilter, setAttachmentFilter] = useState('');
  const [sort, setSort] = useState<ExpenseSort>('date_desc');
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>(
    [undefined],
  );
  const [dialog, setDialog] = useState<{
    expense: Expense | null;
    mode: ExpenseFormMode;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      setSearch(searchText.trim());
      setCursorHistory([undefined]);
    }, 300);
    return () => globalThis.clearTimeout(timeout);
  }, [searchText]);

  const currentCursor = cursorHistory.at(-1);
  const selectedMonthRange = useMemo(
    () => monthDateRange(summaryMonth),
    [summaryMonth],
  );
  const filters = useMemo<ExpenseFilters>(
    () => ({
      categoryId: categoryId || undefined,
      cursor: currentCursor,
      dateFrom: dateFrom || selectedMonthRange.dateFrom,
      dateTo: dateTo || selectedMonthRange.dateTo,
      hasAttachments:
        attachmentFilter === '' ? undefined : attachmentFilter === 'true',
      search: search || undefined,
      sort,
    }),
    [
      attachmentFilter,
      categoryId,
      currentCursor,
      dateFrom,
      dateTo,
      search,
      selectedMonthRange,
      sort,
    ],
  );
  const optionsQuery = useQuery({
    queryFn: () => expenseApi.getOptions(true),
    queryKey: ['expense-options', 'all'],
  });
  const expensesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => expenseApi.list(filters),
    queryKey: ['expenses', filters],
  });
  const summaryQuery = useQuery({
    queryFn: () => expenseApi.getSummary(summaryMonth),
    queryKey: ['expense-summary', summaryMonth],
  });
  const deleteMutation = useMutation({
    mutationFn: expenseApi.delete,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
      ]);
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => {
      const exportFilters = {
        categoryId: filters.categoryId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        hasAttachments: filters.hasAttachments,
        search: filters.search,
        sort: filters.sort,
      };
      return expenseApi.exportCsv(exportFilters);
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bizziemoney-expenses-${todayDate()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const hasFilters = Boolean(
    search || categoryId || dateFrom || dateTo || attachmentFilter,
  );
  const pageNumber = cursorHistory.length;
  const expenses = expensesQuery.data?.items ?? [];

  const removeExpense = (expense: Expense) => {
    if (
      globalThis.confirm(
        `Delete “${expense.description}”? This removes it from your totals.`,
      )
    ) {
      deleteMutation.mutate(expense.id);
    }
  };

  return (
    <div className="expenses-page">
      <div className="page-heading expense-page-heading">
        <div>
          <p className="page-heading__context">Everyday spending</p>
          <h1>Expenses</h1>
          <p className="page-heading__description">
            Add a cost quickly, then find it later without sorting through
            everything.
          </p>
        </div>
        <div className="expense-heading-controls">
          <MonthNavigator
            ariaLabel="Expense summary month"
            month={summaryMonth}
            onChange={(month) => {
              setSummaryMonth(month);
              setDateFrom('');
              setDateTo('');
              setCursorHistory([undefined]);
            }}
          />
          <div className="page-heading__actions">
            <button
              className="button button--secondary"
              onClick={() => setImportOpen(true)}
              type="button"
            >
              <FileUp aria-hidden="true" size={17} />
              Import CSV
            </button>
            <button
              className="button button--secondary"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
              type="button"
            >
              <Download aria-hidden="true" size={17} />
              {exportMutation.isPending ? 'Preparing…' : 'Export CSV'}
            </button>
            <button
              className="button button--primary"
              disabled={!optionsQuery.data}
              onClick={() => setDialog({ expense: null, mode: 'create' })}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              Add expense
            </button>
          </div>
        </div>
      </div>

      <section
        aria-labelledby="expense-summary-title"
        className="expense-summary-strip"
      >
        <div>
          <p>{monthLabel(summaryMonth)}</p>
          <strong id="expense-summary-title">
            {summaryQuery.data
              ? formatMoney(
                  summaryQuery.data.currencyGroups[0]?.totalAmount ?? '0',
                  summaryQuery.data.currencyGroups[0]?.currencyCode ??
                    summaryQuery.data.defaultCurrency,
                )
              : '—'}
          </strong>
          {summaryQuery.data && summaryQuery.data.currencyGroups.length > 1 ? (
            <span className="multi-currency-inline">
              {summaryQuery.data.currencyGroups.slice(1).map((group) => (
                <b key={group.currencyCode}>
                  {formatMoney(group.totalAmount, group.currencyCode)}
                </b>
              ))}
            </span>
          ) : null}
          <span>
            {summaryQuery.data
              ? `${summaryQuery.data.count} expense${
                  summaryQuery.data.count === 1 ? '' : 's'
                }`
              : 'Loading totals…'}
          </span>
        </div>
        <div className="expense-summary-strip__categories">
          {summaryQuery.data?.currencyGroups.map((group) => (
            <div
              className="expense-summary-strip__currency"
              key={group.currencyCode}
            >
              {summaryQuery.data.currencyGroups.length > 1 ? (
                <p>{group.currencyCode}</p>
              ) : null}
              {group.categories.slice(0, 4).map((category) => (
                <span key={`${group.currencyCode}-${category.id}`}>
                  <i style={{ backgroundColor: category.color }} />
                  {category.name}
                  <strong>
                    {formatMoney(category.amount, group.currencyCode)}
                  </strong>
                </span>
              ))}
            </div>
          ))}
          {summaryQuery.data?.currencyGroups.every(
            (group) => group.categories.length === 0,
          ) ? (
            <p>No spending recorded this month.</p>
          ) : null}
        </div>
      </section>

      <section
        aria-label="Expense search and filters"
        className="expense-toolbar"
      >
        <label className="expense-search">
          <span className="sr-only">Search expenses</span>
          <Search aria-hidden="true" size={17} />
          <input
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search description, merchant, or notes"
            type="search"
            value={searchText}
          />
        </label>
        <label>
          <span className="sr-only">Attachments</span>
          <select
            aria-label="Filter by attachments"
            onChange={(event) => {
              setAttachmentFilter(event.target.value);
              setCursorHistory([undefined]);
            }}
            value={attachmentFilter}
          >
            <option value="">All attachments</option>
            <option value="true">With attachments</option>
            <option value="false">Without attachments</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select
            aria-label="Filter by category"
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
                {category.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">From date</span>
          <input
            aria-label="Expenses from date"
            onChange={(event) => {
              setDateFrom(event.target.value);
              setCursorHistory([undefined]);
            }}
            type="date"
            value={dateFrom}
          />
        </label>
        <label>
          <span className="sr-only">To date</span>
          <input
            aria-label="Expenses to date"
            min={dateFrom}
            onChange={(event) => {
              setDateTo(event.target.value);
              setCursorHistory([undefined]);
            }}
            type="date"
            value={dateTo}
          />
        </label>
        <label>
          <span className="sr-only">Sort expenses</span>
          <select
            aria-label="Sort expenses"
            onChange={(event) => {
              setSort(event.target.value as ExpenseSort);
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

      {expensesQuery.isPending || optionsQuery.isPending ? (
        <section className="expense-state" role="status">
          <h2>Loading expenses…</h2>
          <p>Only this page of records is being requested.</p>
        </section>
      ) : expensesQuery.isError || optionsQuery.isError ? (
        <section className="expense-state expense-state--error" role="alert">
          <h2>Expenses could not be loaded.</h2>
          <p>Refresh the page or try again in a moment.</p>
          <button
            className="button button--secondary"
            onClick={() => {
              void Promise.all([
                expensesQuery.refetch(),
                optionsQuery.refetch(),
              ]);
            }}
            type="button"
          >
            Try again
          </button>
        </section>
      ) : expenses.length === 0 ? (
        <section className="expense-state">
          <span aria-hidden="true" className="expense-state__mark">
            <ExpenseOptionIcon name="receipt" size={22} />
          </span>
          <p>{hasFilters ? 'No matches' : 'A clear starting point'}</p>
          <h2>
            {hasFilters
              ? 'No expenses match these filters.'
              : 'Add your first expense when you are ready.'}
          </h2>
          <span>
            {hasFilters
              ? 'Change a date, category, or search term.'
              : 'There are no sample transactions hiding here.'}
          </span>
          <button
            className="button button--primary"
            onClick={() => {
              if (hasFilters) {
                setSearchText('');
                setSearch('');
                setCategoryId('');
                setDateFrom('');
                setDateTo('');
                setAttachmentFilter('');
              } else {
                setDialog({ expense: null, mode: 'create' });
              }
            }}
            type="button"
          >
            {hasFilters ? 'Clear filters' : 'Add expense'}
          </button>
        </section>
      ) : (
        <>
          <div className="expense-table-wrap">
            <table className="expense-table">
              <caption className="sr-only">Expenses, page {pageNumber}</caption>
              <thead>
                <tr>
                  <th scope="col">Expense</th>
                  <th scope="col">Category</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Date</th>
                  <th className="expense-table__amount" scope="col">
                    Amount
                  </th>
                  <th className="expense-table__actions" scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>
                      <strong>{expense.description}</strong>
                      <span>
                        {expense.merchant ?? 'No merchant'}
                        <AttachmentCount count={expense.attachmentCount} />
                      </span>
                    </td>
                    <td>
                      <span
                        className="category-chip"
                        style={categoryStyle(expense.category.color)}
                      >
                        <ExpenseOptionIcon name={expense.category.icon} />
                        {expense.category.name}
                      </span>
                    </td>
                    <td>{expense.paymentMethod.name}</td>
                    <td>{formatExpenseDate(expense.date)}</td>
                    <td className="expense-table__amount">
                      {formatMoney(expense.amount, expense.currencyCode)}
                    </td>
                    <td>
                      <ExpenseActions
                        expense={expense}
                        onDelete={() => removeExpense(expense)}
                        onDuplicate={() =>
                          setDialog({ expense, mode: 'duplicate' })
                        }
                        onEdit={() => setDialog({ expense, mode: 'edit' })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="expense-cards">
            {expenses.map((expense) => (
              <article className="expense-card" key={expense.id}>
                <div className="expense-card__top">
                  <span
                    className="expense-card__icon"
                    style={categoryStyle(expense.category.color)}
                  >
                    <ExpenseOptionIcon name={expense.category.icon} />
                  </span>
                  <div>
                    <strong>{expense.description}</strong>
                    <span>
                      {expense.category.name} ·{' '}
                      {formatExpenseDate(expense.date)}
                    </span>
                  </div>
                  <b>{formatMoney(expense.amount, expense.currencyCode)}</b>
                </div>
                <div className="expense-card__footer">
                  <span>
                    {expense.paymentMethod.name}
                    <AttachmentCount count={expense.attachmentCount} />
                  </span>
                  <ExpenseActions
                    expense={expense}
                    onDelete={() => removeExpense(expense)}
                    onDuplicate={() =>
                      setDialog({ expense, mode: 'duplicate' })
                    }
                    onEdit={() => setDialog({ expense, mode: 'edit' })}
                  />
                </div>
              </article>
            ))}
          </div>

          <nav aria-label="Expense pages" className="pagination">
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
            <span>Page {pageNumber}</span>
            <button
              className="button button--secondary"
              disabled={!expensesQuery.data?.nextCursor}
              onClick={() => {
                const nextCursor = expensesQuery.data?.nextCursor;
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

      {deleteMutation.error instanceof ApiError ? (
        <p className="form-message form-message--error" role="alert">
          {deleteMutation.error.message}
        </p>
      ) : null}
      {exportMutation.error instanceof ApiError ? (
        <p className="form-message form-message--error" role="alert">
          The CSV export could not be prepared. {exportMutation.error.message}
        </p>
      ) : null}

      {optionsQuery.data ? (
        <ExpenseFormDialog
          expense={dialog?.expense ?? null}
          mode={dialog?.mode ?? 'create'}
          onClose={() => setDialog(null)}
          open={dialog !== null}
          options={optionsQuery.data}
        />
      ) : null}
      {importOpen ? (
        <Suspense fallback={null}>
          <ExpenseImportDialog
            onClose={() => setImportOpen(false)}
            open={importOpen}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function ExpenseActions({
  expense,
  onDelete,
  onDuplicate,
  onEdit,
}: {
  expense: Expense;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="expense-actions">
      <button
        aria-label={`Edit ${expense.description}`}
        onClick={onEdit}
        title="Edit"
        type="button"
      >
        <Edit3 aria-hidden="true" size={16} />
      </button>
      <button
        aria-label={`Duplicate ${expense.description}`}
        onClick={onDuplicate}
        title="Duplicate"
        type="button"
      >
        <Copy aria-hidden="true" size={16} />
      </button>
      <button
        aria-label={`Delete ${expense.description}`}
        className="expense-actions__danger"
        onClick={onDelete}
        title="Delete"
        type="button"
      >
        <Trash2 aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
