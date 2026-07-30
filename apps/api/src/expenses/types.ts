export const expenseSorts = [
  'date_desc',
  'date_asc',
  'amount_desc',
  'amount_asc',
  'updated_desc',
] as const;

export type ExpenseSort = (typeof expenseSorts)[number];

export interface MoneyOption {
  archived: boolean;
  color?: string;
  icon: string;
  id: string;
  name: string;
}

export interface ExpenseRecord {
  amount: string;
  attachmentCount: number;
  category: MoneyOption;
  createdAt: Date;
  currencyCode: string;
  date: string;
  description: string;
  id: string;
  merchant: string | null;
  notes: string | null;
  paymentMethod: MoneyOption;
  tags: string[];
  updatedAt: Date;
}

export interface PublicExpense {
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

export interface ExpenseCursor {
  id: string;
  value: string;
}

export interface ExpenseFilters {
  categoryId?: string | undefined;
  cursor?: ExpenseCursor | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  hasAttachments?: boolean | undefined;
  limit: number;
  search?: string | undefined;
  sort: ExpenseSort;
}

export interface ExpensePage {
  hasMore: boolean;
  items: ExpenseRecord[];
}

export interface ExpenseListResponse {
  items: PublicExpense[];
  nextCursor: string | null;
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

export interface ExpenseImportRow extends ExpenseWriteInput {
  currencyCode: string;
  rowNumber: number;
}

export interface ExpenseImportResult {
  currencyCounts: Record<string, number>;
  importedCount: number;
  replayed: boolean;
}

export interface ImportExpensesStoreInput {
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  requestHash: string;
  rows: ExpenseImportRow[];
  sessionId: string;
}

export interface ImportExpensesStoreResult extends ExpenseImportResult {
  mismatched: boolean;
}

export interface CreateExpenseStoreInput extends ExpenseWriteInput {
  expenseId: string;
  idempotencyKey: string;
  now: Date;
  ownerId: string;
  requestHash: string;
  sessionId: string;
}

export interface UpdateExpenseStoreInput extends ExpenseWriteInput {
  expenseId: string;
  now: Date;
  ownerId: string;
  sessionId: string;
}

export interface CategorySummary {
  amount: string;
  color: string;
  id: string;
  name: string;
}

export interface ExpenseCurrencyGroup {
  categories: CategorySummary[];
  currencyCode: string;
  totalAmount: string;
}

export interface ExpenseSummary {
  count: number;
  currencyGroups: ExpenseCurrencyGroup[];
  defaultCurrency: string;
  month: string;
  recent: PublicExpense[];
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

export interface ExpenseServiceContract {
  createCategory(
    ownerId: string,
    input: { color: string; icon: string; name: string },
  ): Promise<MoneyOption>;
  createExpense(
    ownerId: string,
    sessionId: string,
    idempotencyKey: string,
    input: ExpenseWriteInput,
  ): Promise<{ expense: PublicExpense; replayed: boolean }>;
  createPaymentMethod(
    ownerId: string,
    input: { icon: string; name: string },
  ): Promise<MoneyOption>;
  deleteCategory(
    ownerId: string,
    sessionId: string,
    categoryId: string,
    replacementCategoryId: string,
  ): Promise<CategoryDeletionResult>;
  deleteExpense(
    ownerId: string,
    sessionId: string,
    expenseId: string,
  ): Promise<void>;
  exportExpenses(
    ownerId: string,
    filters: Omit<ExpenseFilters, 'cursor' | 'limit'>,
  ): AsyncGenerator<string>;
  getExpense(ownerId: string, expenseId: string): Promise<PublicExpense>;
  getOptions(
    ownerId: string,
    includeArchived: boolean,
  ): Promise<ExpenseOptions>;
  getCategoryDeletionPreview(
    ownerId: string,
    categoryId: string,
  ): Promise<CategoryDeletionPreview>;
  getSummary(ownerId: string, month: string): Promise<ExpenseSummary>;
  importExpenses(
    ownerId: string,
    sessionId: string,
    idempotencyKey: string,
    csvText: string,
  ): Promise<ExpenseImportResult>;
  listExpenses(
    ownerId: string,
    input: {
      categoryId?: string | undefined;
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      hasAttachments?: boolean | undefined;
      limit: number;
      search?: string | undefined;
      sort: ExpenseSort;
    },
  ): Promise<ExpenseListResponse>;
  previewImport(
    ownerId: string,
    csvText: string,
  ): Promise<ExpenseImportPreview>;
  updateCategory(
    ownerId: string,
    categoryId: string,
    input: Partial<{
      archived: boolean | undefined;
      color: string | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption>;
  updateExpense(
    ownerId: string,
    sessionId: string,
    expenseId: string,
    input: ExpenseWriteInput,
  ): Promise<PublicExpense>;
  updatePaymentMethod(
    ownerId: string,
    paymentMethodId: string,
    input: Partial<{
      archived: boolean | undefined;
      icon: string | undefined;
      name: string | undefined;
    }>,
  ): Promise<MoneyOption>;
}
