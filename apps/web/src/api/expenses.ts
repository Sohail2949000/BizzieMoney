import { apiRequest } from './client';

export type ExpenseSort =
  'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'updated_desc';

export interface MoneyOption {
  archived: boolean;
  color?: string;
  icon: string;
  id: string;
  name: string;
}

export interface Expense {
  amount: string;
  attachmentCount: number;
  category: MoneyOption;
  createdAt: string;
  currencyCode: string;
  date: string;
  description: string;
  id: string;
  merchant: string | null;
  notes: string | null;
  paymentMethod: MoneyOption;
  tags: string[];
  updatedAt: string;
}

export interface ExpenseWriteInput {
  amount: string;
  categoryId: string;
  date: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  paymentMethodId: string | null;
  tags: string[];
}

export interface ExpenseFilters {
  categoryId?: string | undefined;
  cursor?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  hasAttachments?: boolean | undefined;
  search?: string | undefined;
  sort: ExpenseSort;
}

export interface ExpenseOptions {
  categories: MoneyOption[];
  paymentMethods: MoneyOption[];
}

export interface CategoryDeletionPreview {
  category: MoneyOption;
  expenseCount: number;
  replacements: MoneyOption[];
  subscriptionCount: number;
}

export interface CategoryDeletionResult {
  deletedCategoryId: string;
  expenseCount: number;
  replacement: MoneyOption;
  subscriptionCount: number;
}

export interface ExpenseSummary {
  count: number;
  currencyGroups: Array<{
    categories: Array<{
      amount: string;
      color: string;
      id: string;
      name: string;
    }>;
    currencyCode: string;
    totalAmount: string;
  }>;
  defaultCurrency: string;
  month: string;
  recent: Expense[];
}

export interface ExpenseImportError {
  field: string;
  message: string;
}

export interface ExpenseImportPreviewRow {
  amount: string;
  categoryId: string | null;
  categoryName: string;
  currencyCode: string;
  date: string;
  description: string;
  errors: ExpenseImportError[];
  merchant: string | null;
  notes: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string;
  rowNumber: number;
  tags: string[];
  valid: boolean;
}

export interface ExpenseImportPreview {
  errorCount: number;
  rows: ExpenseImportPreviewRow[];
  totalRows: number;
  validCount: number;
}

export interface ExpenseImportResult {
  currencyCounts: Record<string, number>;
  importedCount: number;
  replayed: boolean;
}

function searchParams(
  values: Record<string, number | string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      params.set(name, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function expenseQuery(filters: ExpenseFilters): string {
  return searchParams({
    categoryId: filters.categoryId,
    cursor: filters.cursor,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    hasAttachments:
      filters.hasAttachments === undefined
        ? undefined
        : String(filters.hasAttachments),
    search: filters.search,
    sort: filters.sort,
  });
}

export const expenseApi = {
  create: (input: ExpenseWriteInput, idempotencyKey: string) =>
    apiRequest<Expense>('/api/expenses', {
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      method: 'POST',
    }),
  createCategory: (input: { color: string; icon: string; name: string }) =>
    apiRequest<MoneyOption>('/api/expense-categories', {
      body: input,
      method: 'POST',
    }),
  createPaymentMethod: (input: { icon: string; name: string }) =>
    apiRequest<MoneyOption>('/api/payment-methods', {
      body: input,
      method: 'POST',
    }),
  deleteCategory: (categoryId: string, replacementCategoryId: string) =>
    apiRequest<CategoryDeletionResult>(
      `/api/expense-categories/${categoryId}`,
      {
        body: { replacementCategoryId },
        method: 'DELETE',
      },
    ),
  delete: (expenseId: string) =>
    apiRequest<void>(`/api/expenses/${expenseId}`, { method: 'DELETE' }),
  exportCsv: (filters: Omit<ExpenseFilters, 'cursor'>) =>
    apiRequest<Blob>(`/api/expenses/export.csv${expenseQuery(filters)}`, {
      responseType: 'blob',
    }),
  get: (expenseId: string) => apiRequest<Expense>(`/api/expenses/${expenseId}`),
  getOptions: (includeArchived = false) =>
    apiRequest<ExpenseOptions>(
      `/api/expense-options${searchParams({
        includeArchived: includeArchived ? 'true' : undefined,
      })}`,
    ),
  getCategoryDeletionPreview: (categoryId: string) =>
    apiRequest<CategoryDeletionPreview>(
      `/api/expense-categories/${categoryId}/deletion-preview`,
    ),
  getSummary: (month: string) =>
    apiRequest<ExpenseSummary>(
      `/api/expenses/summary${searchParams({ month })}`,
    ),
  importCsv: (csvText: string, idempotencyKey: string) =>
    apiRequest<ExpenseImportResult>('/api/expenses/import', {
      body: { csvText },
      headers: { 'idempotency-key': idempotencyKey },
      method: 'POST',
    }),
  list: (filters: ExpenseFilters) =>
    apiRequest<{ items: Expense[]; nextCursor: string | null }>(
      `/api/expenses${expenseQuery(filters)}`,
    ),
  previewImport: (csvText: string) =>
    apiRequest<ExpenseImportPreview>('/api/expenses/import/preview', {
      body: { csvText },
      method: 'POST',
    }),
  update: (expenseId: string, input: ExpenseWriteInput) =>
    apiRequest<Expense>(`/api/expenses/${expenseId}`, {
      body: input,
      method: 'PATCH',
    }),
  updateCategory: (
    categoryId: string,
    input: Partial<{
      archived: boolean;
      color: string;
      icon: string;
      name: string;
    }>,
  ) =>
    apiRequest<MoneyOption>(`/api/expense-categories/${categoryId}`, {
      body: input,
      method: 'PATCH',
    }),
  updatePaymentMethod: (
    paymentMethodId: string,
    input: Partial<{ archived: boolean; icon: string; name: string }>,
  ) =>
    apiRequest<MoneyOption>(`/api/payment-methods/${paymentMethodId}`, {
      body: input,
      method: 'PATCH',
    }),
};
