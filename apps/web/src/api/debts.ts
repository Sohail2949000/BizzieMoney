import { apiRequest } from './client';

export type DebtDirection = 'i_owe' | 'owed_to_me';
export type DebtStatus = 'active' | 'paid' | 'overdue' | 'paused' | 'cancelled';
export type DebtFrequency =
  'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
export type DebtSort = 'due_asc' | 'amount_desc' | 'updated_desc';

export interface Debt {
  attachmentCount: number;
  createdAt: string;
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

export interface DebtPayment {
  amount: string;
  attachmentCount: number;
  createdAt: string;
  currencyCode: string;
  debtId: string;
  debtName: string;
  id: string;
  notes: string | null;
  paymentDate: string;
  updatedAt: string;
}

export interface DebtPaymentWriteInput {
  allowOverpayment: boolean;
  amount: string;
  notes: string | null;
  paymentDate: string;
}

export interface DebtFilters {
  cursor?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  direction: DebtDirection;
  search?: string | undefined;
  sort: DebtSort;
  status?: DebtStatus | undefined;
}

function searchParams(
  values: Record<string, number | string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(name, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const debtApi = {
  cancel: (debtId: string) =>
    apiRequest<Debt>(`/api/debts/${debtId}/cancel`, { method: 'POST' }),
  complete: (debtId: string) =>
    apiRequest<Debt>(`/api/debts/${debtId}/complete`, { method: 'POST' }),
  create: (input: DebtWriteInput) =>
    apiRequest<Debt>('/api/debts', { body: input, method: 'POST' }),
  delete: (debtId: string) =>
    apiRequest<void>(`/api/debts/${debtId}`, { method: 'DELETE' }),
  deletePayment: (paymentId: string) =>
    apiRequest<void>(`/api/debt-payments/${paymentId}`, {
      method: 'DELETE',
    }),
  get: (debtId: string) => apiRequest<Debt>(`/api/debts/${debtId}`),
  getSummary: () =>
    apiRequest<{
      currencyGroups: Array<{
        currencyCode: string;
        iOwe: string;
        owedToMe: string;
      }>;
      defaultCurrency: string;
    }>('/api/debts/summary'),
  list: (filters: DebtFilters) =>
    apiRequest<{ items: Debt[]; nextCursor: string | null }>(
      `/api/debts${searchParams({
        cursor: filters.cursor,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        direction: filters.direction,
        search: filters.search,
        sort: filters.sort,
        status: filters.status,
      })}`,
    ),
  listPayments: (debtId: string, cursor?: string) =>
    apiRequest<{ items: DebtPayment[]; nextCursor: string | null }>(
      `/api/debts/${debtId}/payments${searchParams({ cursor })}`,
    ),
  listUpcoming: (days = 30, limit = 25) =>
    apiRequest<{
      items: Array<{
        amount: string;
        currencyCode: string;
        daysUntilDue: number;
        direction: DebtDirection;
        dueDate: string;
        id: string;
        name: string;
        status: 'active' | 'overdue';
      }>;
      overdueCount: number;
    }>(`/api/debts/upcoming${searchParams({ days, limit })}`),
  pause: (debtId: string) =>
    apiRequest<Debt>(`/api/debts/${debtId}/pause`, { method: 'POST' }),
  recordPayment: (
    debtId: string,
    input: DebtPaymentWriteInput,
    idempotencyKey: string,
  ) =>
    apiRequest<DebtPayment>(`/api/debts/${debtId}/payments`, {
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      method: 'POST',
    }),
  reopen: (debtId: string) =>
    apiRequest<Debt>(`/api/debts/${debtId}/reopen`, { method: 'POST' }),
  resume: (debtId: string) =>
    apiRequest<Debt>(`/api/debts/${debtId}/resume`, { method: 'POST' }),
  update: (debtId: string, input: DebtWriteInput) =>
    apiRequest<Debt>(`/api/debts/${debtId}`, {
      body: input,
      method: 'PATCH',
    }),
  updatePayment: (paymentId: string, input: DebtPaymentWriteInput) =>
    apiRequest<DebtPayment>(`/api/debt-payments/${paymentId}`, {
      body: input,
      method: 'PATCH',
    }),
};
