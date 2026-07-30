export const billingFrequencies = [
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'yearly',
  'custom',
] as const;

export const subscriptionStatuses = [
  'active',
  'paused',
  'cancelled',
  'ended',
] as const;

export const subscriptionSorts = [
  'next_asc',
  'next_desc',
  'amount_desc',
  'updated_desc',
] as const;

export type BillingFrequency = (typeof billingFrequencies)[number];
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];
export type SubscriptionSort = (typeof subscriptionSorts)[number];

export interface SubscriptionCategory {
  archived: boolean;
  color: string;
  icon: string;
  id: string;
  name: string;
}

export interface SubscriptionRecord {
  amount: string;
  attachmentCount: number;
  autoRenew: boolean;
  billingFrequency: BillingFrequency;
  category: SubscriptionCategory;
  createdAt: Date;
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
  updatedAt: Date;
}

export interface PublicSubscription extends Omit<
  SubscriptionRecord,
  'createdAt' | 'updatedAt'
> {
  createdAt: string;
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

export interface SubscriptionCursor {
  id: string;
  value: string;
}

export interface SubscriptionFilters {
  categoryId?: string | undefined;
  cursor?: SubscriptionCursor | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit: number;
  search?: string | undefined;
  sort: SubscriptionSort;
  status?: SubscriptionStatus | undefined;
}

export interface SubscriptionPage {
  hasMore: boolean;
  items: SubscriptionRecord[];
}

export interface SubscriptionListResponse {
  items: PublicSubscription[];
  nextCursor: string | null;
}

export interface SubscriptionPaymentRecord {
  amount: string;
  convertedExpenseId: string | null;
  createdAt: Date;
  currencyCode: string;
  id: string;
  paidDate: string;
  scheduledDate: string;
  subscriptionId: string;
  subscriptionName: string;
}

export interface PublicSubscriptionPayment extends Omit<
  SubscriptionPaymentRecord,
  'createdAt'
> {
  createdAt: string;
}

export interface SubscriptionPaymentPage {
  hasMore: boolean;
  items: SubscriptionPaymentRecord[];
}

export interface SubscriptionPaymentListResponse {
  items: PublicSubscriptionPayment[];
  nextCursor: string | null;
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

export interface SubscriptionUpcomingResponse {
  dueSoonCount: number;
  items: SubscriptionUpcoming[];
  overdueCount: number;
}

export interface SubscriptionReminder {
  amount: string;
  currencyCode: string;
  id: string;
  name: string;
  paymentDate: string;
  subscriptionId: string;
}

export interface SubscriptionServiceContract {
  cancel(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription>;
  convertPaymentToExpense(
    ownerId: string,
    sessionId: string,
    paymentId: string,
    idempotencyKey: string,
    paymentMethodId: string,
  ): Promise<{ expenseId: string; replayed: boolean }>;
  create(
    ownerId: string,
    sessionId: string,
    input: SubscriptionWriteInput,
  ): Promise<PublicSubscription>;
  delete(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<void>;
  dismissReminder(ownerId: string, reminderId: string): Promise<void>;
  get(ownerId: string, subscriptionId: string): Promise<PublicSubscription>;
  list(
    ownerId: string,
    input: {
      categoryId?: string | undefined;
      cursor?: string | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      limit: number;
      search?: string | undefined;
      sort: SubscriptionSort;
      status?: SubscriptionStatus | undefined;
    },
  ): Promise<SubscriptionListResponse>;
  listPayments(
    ownerId: string,
    subscriptionId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<SubscriptionPaymentListResponse>;
  listReminders(ownerId: string): Promise<SubscriptionReminder[]>;
  listUpcoming(
    ownerId: string,
    days: number,
    limit: number,
  ): Promise<SubscriptionUpcomingResponse>;
  pause(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription>;
  recordPayment(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
    idempotencyKey: string,
    input: { amount: string | null; paidDate: string },
  ): Promise<{ payment: PublicSubscriptionPayment; replayed: boolean }>;
  resume(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
  ): Promise<PublicSubscription>;
  update(
    ownerId: string,
    sessionId: string,
    subscriptionId: string,
    input: SubscriptionWriteInput,
  ): Promise<PublicSubscription>;
}
