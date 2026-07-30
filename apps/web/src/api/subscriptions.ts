import { apiRequest } from './client';

export type BillingFrequency =
  'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'ended';
export type SubscriptionSort =
  'next_asc' | 'next_desc' | 'amount_desc' | 'updated_desc';

export interface Subscription {
  amount: string;
  attachmentCount: number;
  autoRenew: boolean;
  billingFrequency: BillingFrequency;
  category: {
    archived: boolean;
    color: string;
    icon: string;
    id: string;
    name: string;
  };
  createdAt: string;
  currencyCode: string;
  customIntervalDays: number | null;
  endDate: string | null;
  id: string;
  name: string;
  nextPaymentDate: string;
  notes: string | null;
  reminderDays: number;
  startDate: string | null;
  status: SubscriptionStatus;
  updatedAt: string;
}

export interface SubscriptionWriteInput {
  amount: string;
  autoRenew: boolean;
  billingFrequency: BillingFrequency;
  categoryId: string;
  customIntervalDays: number | null;
  endDate: string | null;
  name: string;
  nextPaymentDate: string;
  notes: string | null;
  reminderDays: number;
  startDate: string | null;
}

export interface SubscriptionPayment {
  amount: string;
  convertedExpenseId: string | null;
  createdAt: string;
  currencyCode: string;
  id: string;
  paidDate: string;
  scheduledDate: string;
  subscriptionId: string;
  subscriptionName: string;
}

export interface SubscriptionUpcoming {
  amount: string;
  currencyCode: string;
  daysUntilDue: number;
  id: string;
  name: string;
  nextPaymentDate: string;
  overdue: boolean;
}

export interface SubscriptionReminder {
  amount: string;
  currencyCode: string;
  id: string;
  name: string;
  paymentDate: string;
  subscriptionId: string;
}

export interface SubscriptionFilters {
  categoryId?: string | undefined;
  cursor?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  search?: string | undefined;
  sort: SubscriptionSort;
  status?: SubscriptionStatus | undefined;
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

export const subscriptionApi = {
  cancel: (subscriptionId: string) =>
    apiRequest<Subscription>(`/api/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
    }),
  convertPayment: (
    paymentId: string,
    paymentMethodId: string,
    idempotencyKey: string,
  ) =>
    apiRequest<{ expenseId: string }>(
      `/api/subscription-payments/${paymentId}/convert`,
      {
        body: { paymentMethodId },
        headers: { 'idempotency-key': idempotencyKey },
        method: 'POST',
      },
    ),
  create: (input: SubscriptionWriteInput) =>
    apiRequest<Subscription>('/api/subscriptions', {
      body: input,
      method: 'POST',
    }),
  delete: (subscriptionId: string) =>
    apiRequest<void>(`/api/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
    }),
  dismissReminder: (reminderId: string) =>
    apiRequest<void>(`/api/subscription-reminders/${reminderId}`, {
      method: 'DELETE',
    }),
  get: (subscriptionId: string) =>
    apiRequest<Subscription>(`/api/subscriptions/${subscriptionId}`),
  list: (filters: SubscriptionFilters) =>
    apiRequest<{ items: Subscription[]; nextCursor: string | null }>(
      `/api/subscriptions${searchParams({
        categoryId: filters.categoryId,
        cursor: filters.cursor,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        search: filters.search,
        sort: filters.sort,
        status: filters.status,
      })}`,
    ),
  listPayments: (subscriptionId: string, cursor?: string) =>
    apiRequest<{
      items: SubscriptionPayment[];
      nextCursor: string | null;
    }>(
      `/api/subscriptions/${subscriptionId}/payments${searchParams({
        cursor,
      })}`,
    ),
  listReminders: () =>
    apiRequest<SubscriptionReminder[]>('/api/subscription-reminders'),
  listUpcoming: (days = 30, limit = 25) =>
    apiRequest<{
      dueSoonCount: number;
      items: SubscriptionUpcoming[];
      overdueCount: number;
    }>(`/api/subscriptions/upcoming${searchParams({ days, limit })}`),
  pause: (subscriptionId: string) =>
    apiRequest<Subscription>(`/api/subscriptions/${subscriptionId}/pause`, {
      method: 'POST',
    }),
  recordPayment: (
    subscriptionId: string,
    input: { amount: string | null; paidDate: string },
    idempotencyKey: string,
  ) =>
    apiRequest<SubscriptionPayment>(
      `/api/subscriptions/${subscriptionId}/payments`,
      {
        body: input,
        headers: { 'idempotency-key': idempotencyKey },
        method: 'POST',
      },
    ),
  resume: (subscriptionId: string) =>
    apiRequest<Subscription>(`/api/subscriptions/${subscriptionId}/resume`, {
      method: 'POST',
    }),
  update: (subscriptionId: string, input: SubscriptionWriteInput) =>
    apiRequest<Subscription>(`/api/subscriptions/${subscriptionId}`, {
      body: input,
      method: 'PATCH',
    }),
};
