export const debtDirections = ['i_owe', 'owed_to_me'] as const;
export const debtStatuses = [
  'active',
  'paid',
  'overdue',
  'paused',
  'cancelled',
] as const;
export const debtFrequencies = [
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'yearly',
  'custom',
] as const;
export const debtSorts = ['due_asc', 'amount_desc', 'updated_desc'] as const;

export type DebtDirection = (typeof debtDirections)[number];
export type DebtStatus = (typeof debtStatuses)[number];
export type DebtFrequency = (typeof debtFrequencies)[number];
export type DebtSort = (typeof debtSorts)[number];

export interface DebtRecord {
  attachmentCount: number;
  createdAt: Date;
  currencyCode: string;
  customIntervalDays: number | null;
  direction: DebtDirection;
  dueDate: string | null;
  id: string;
  installmentAmount: string | null;
  installmentFrequency: DebtFrequency | null;
  interestNote: string | null;
  name: string;
  nextPaymentDate: string | null;
  notes: string | null;
  originalAmount: string;
  overpaidAmount: string;
  paidAmount: string;
  remainingAmount: string;
  startDate: string;
  status: DebtStatus;
  updatedAt: Date;
}

export interface PublicDebt extends Omit<
  DebtRecord,
  'createdAt' | 'updatedAt'
> {
  createdAt: string;
  updatedAt: string;
}

export interface DebtWriteInput {
  customIntervalDays: number | null;
  direction: DebtDirection;
  dueDate: string | null;
  installmentAmount: string | null;
  installmentFrequency: DebtFrequency | null;
  interestNote: string | null;
  name: string;
  nextPaymentDate: string | null;
  notes: string | null;
  originalAmount: string;
  startDate: string;
}

export interface DebtCursor {
  id: string;
  value: string;
}

export interface DebtFilters {
  cursor?: DebtCursor | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  direction: DebtDirection;
  limit: number;
  search?: string | undefined;
  sort: DebtSort;
  status?: DebtStatus | undefined;
}

export interface DebtPage {
  hasMore: boolean;
  items: DebtRecord[];
}

export interface DebtListResponse {
  items: PublicDebt[];
  nextCursor: string | null;
}

export interface DebtPaymentRecord {
  amount: string;
  attachmentCount: number;
  createdAt: Date;
  currencyCode: string;
  debtId: string;
  debtName: string;
  id: string;
  notes: string | null;
  paymentDate: string;
  updatedAt: Date;
}

export interface PublicDebtPayment extends Omit<
  DebtPaymentRecord,
  'createdAt' | 'updatedAt'
> {
  createdAt: string;
  updatedAt: string;
}

export interface DebtPaymentWriteInput {
  allowOverpayment: boolean;
  amount: string;
  notes: string | null;
  paymentDate: string;
}

export interface DebtPaymentPage {
  hasMore: boolean;
  items: DebtPaymentRecord[];
}

export interface DebtPaymentListResponse {
  items: PublicDebtPayment[];
  nextCursor: string | null;
}

export interface DebtSummary {
  currencyGroups: Array<{
    currencyCode: string;
    iOwe: string;
    owedToMe: string;
  }>;
  defaultCurrency: string;
}

export interface DebtUpcoming {
  amount: string;
  currencyCode: string;
  daysUntilDue: number;
  direction: DebtDirection;
  dueDate: string;
  id: string;
  name: string;
  status: 'active' | 'overdue';
}

export interface DebtUpcomingResponse {
  items: DebtUpcoming[];
  overdueCount: number;
}

export interface DebtServiceContract {
  changeStatus(
    ownerId: string,
    sessionId: string,
    debtId: string,
    action: 'cancel' | 'complete' | 'pause' | 'reopen' | 'resume',
  ): Promise<PublicDebt>;
  create(
    ownerId: string,
    sessionId: string,
    input: DebtWriteInput,
  ): Promise<PublicDebt>;
  delete(ownerId: string, sessionId: string, debtId: string): Promise<void>;
  deletePayment(
    ownerId: string,
    sessionId: string,
    paymentId: string,
  ): Promise<void>;
  get(ownerId: string, debtId: string): Promise<PublicDebt>;
  getSummary(ownerId: string): Promise<DebtSummary>;
  list(
    ownerId: string,
    input: {
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      direction: DebtDirection;
      limit: number;
      search?: string | undefined;
      sort: DebtSort;
      status?: DebtStatus | undefined;
    },
  ): Promise<DebtListResponse>;
  listPayments(
    ownerId: string,
    debtId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<DebtPaymentListResponse>;
  listUpcoming(
    ownerId: string,
    days: number,
    limit: number,
  ): Promise<DebtUpcomingResponse>;
  recordPayment(
    ownerId: string,
    sessionId: string,
    debtId: string,
    idempotencyKey: string,
    input: DebtPaymentWriteInput,
  ): Promise<{ payment: PublicDebtPayment; replayed: boolean }>;
  update(
    ownerId: string,
    sessionId: string,
    debtId: string,
    input: DebtWriteInput,
  ): Promise<PublicDebt>;
  updatePayment(
    ownerId: string,
    sessionId: string,
    paymentId: string,
    input: DebtPaymentWriteInput,
  ): Promise<PublicDebtPayment>;
}
