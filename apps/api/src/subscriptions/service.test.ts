import { describe, expect, it, vi } from 'vitest';

import { SubscriptionService } from './service';
import type { SubscriptionStore } from './store';
import type { SubscriptionPaymentRecord, SubscriptionRecord } from './types';

const ownerId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const subscriptionId = '00000000-0000-4000-8000-000000000003';
const paymentId = '00000000-0000-4000-8000-000000000004';

const subscription: SubscriptionRecord = {
  amount: '29.9900',
  attachmentCount: 0,
  autoRenew: true,
  billingFrequency: 'monthly',
  category: {
    archived: false,
    color: '#D97706',
    icon: 'receipt',
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Bills & Utilities',
  },
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  currencyCode: 'USD',
  customIntervalDays: null,
  endDate: null,
  id: subscriptionId,
  name: 'Internet',
  nextPaymentDate: '2026-08-01',
  notes: null,
  reminderDays: 3,
  startDate: null,
  status: 'active',
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
};

const payment: SubscriptionPaymentRecord = {
  amount: '29.9900',
  convertedExpenseId: null,
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  currencyCode: 'USD',
  id: paymentId,
  paidDate: '2026-07-27',
  scheduledDate: '2026-08-01',
  subscriptionId,
  subscriptionName: 'Internet',
};

function createStore(overrides: Partial<SubscriptionStore> = {}): {
  createSubscription: ReturnType<typeof vi.fn>;
  store: SubscriptionStore;
} {
  const createSubscription = vi.fn(() => Promise.resolve(true));
  return {
    createSubscription,
    store: {
      changeStatus: vi.fn(() => Promise.resolve(true)),
      convertPayment: vi.fn(() =>
        Promise.resolve({
          expenseId: '00000000-0000-4000-8000-000000000006',
          mismatched: false,
          replayed: false,
        }),
      ),
      createSubscription,
      deleteSubscription: vi.fn(() => Promise.resolve(true)),
      dismissReminder: vi.fn(() => Promise.resolve(true)),
      getPayment: vi.fn(() => Promise.resolve(payment)),
      getSubscription: vi.fn(() => Promise.resolve(subscription)),
      getTimeZone: vi.fn(() => Promise.resolve('UTC')),
      listPayments: vi.fn(() =>
        Promise.resolve({ hasMore: false, items: [payment] }),
      ),
      listReminders: vi.fn(() => Promise.resolve([])),
      listSubscriptions: vi.fn(() =>
        Promise.resolve({ hasMore: false, items: [subscription] }),
      ),
      listUpcoming: vi.fn(() =>
        Promise.resolve({ dueSoonCount: 0, items: [], overdueCount: 0 }),
      ),
      recordPayment: vi.fn(() =>
        Promise.resolve({
          mismatched: false,
          paymentId,
          replayed: false,
        }),
      ),
      updateSubscription: vi.fn(() => Promise.resolve(true)),
      ...overrides,
    },
  };
}

describe('subscription service', () => {
  it('normalizes a valid subscription before creating it', async () => {
    const { createSubscription, store } = createStore();
    const service = new SubscriptionService(
      store,
      () => new Date('2026-07-27T00:00:00.000Z'),
    );

    await service.create(ownerId, sessionId, {
      amount: '29.99',
      autoRenew: true,
      billingFrequency: 'monthly',
      categoryId: subscription.category.id,
      customIntervalDays: null,
      endDate: null,
      name: '  Internet  ',
      nextPaymentDate: '2026-08-01',
      notes: '  Home service  ',
      reminderDays: 3,
      startDate: null,
    });

    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Internet',
        notes: 'Home service',
        ownerId,
        sessionId,
      }),
    );
  });

  it('rejects an end date before the next payment', async () => {
    const { createSubscription, store } = createStore();
    const service = new SubscriptionService(store);

    await expect(
      service.create(ownerId, sessionId, {
        amount: '29.99',
        autoRenew: true,
        billingFrequency: 'monthly',
        categoryId: subscription.category.id,
        customIntervalDays: null,
        endDate: '2026-07-31',
        name: 'Internet',
        nextPaymentDate: '2026-08-01',
        notes: null,
        reminderDays: 3,
        startDate: null,
      }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_DATE_RANGE_INVALID',
      statusCode: 400,
    });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('returns an idempotent payment replay without duplicating it', async () => {
    const { store } = createStore({
      recordPayment: vi.fn(() =>
        Promise.resolve({
          mismatched: false,
          paymentId,
          replayed: true,
        }),
      ),
    });
    const service = new SubscriptionService(store);

    await expect(
      service.recordPayment(
        ownerId,
        sessionId,
        subscriptionId,
        '00000000-0000-4000-8000-000000000007',
        { amount: null, paidDate: '2026-07-27' },
      ),
    ).resolves.toMatchObject({
      payment: { id: paymentId },
      replayed: true,
    });
  });

  it('rejects cursor contents tied to a different sort', async () => {
    const { store } = createStore();
    const service = new SubscriptionService(store);
    const cursor = Buffer.from(
      JSON.stringify({
        id: subscriptionId,
        sort: 'next_desc',
        value: '2026-08-01',
        version: 1,
      }),
    ).toString('base64url');

    await expect(
      service.list(ownerId, {
        cursor,
        limit: 25,
        sort: 'next_asc',
      }),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });

  it('passes the selected month range to the subscription store', async () => {
    const listSubscriptions = vi.fn(() =>
      Promise.resolve({ hasMore: false, items: [subscription] }),
    );
    const { store } = createStore({ listSubscriptions });
    const service = new SubscriptionService(store);

    await service.list(ownerId, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      limit: 25,
      sort: 'next_asc',
    });

    expect(listSubscriptions).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      }),
    );
  });
});
