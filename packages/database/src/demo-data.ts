import { createHash } from 'node:crypto';

import type { Insertable } from 'kysely';

import type { DatabaseSchema } from './types';

export const DEMO_MONTH_COUNTS = [
  25, 20, 30, 10, 24, 18, 28, 22, 26, 16, 20, 30,
] as const;

export const DEMO_CURRENCIES = [
  'USD',
  'SAR',
  'EUR',
  'GBP',
  'AED',
  'JPY',
] as const;

export const DEMO_CATEGORY_NAMES = [
  'Food & Dining',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Health',
  'Housing',
  'Education',
  'Entertainment',
  'Other',
] as const;

export const DEMO_PAYMENT_METHOD_NAMES = [
  'Cash',
  'Bank card',
  'Bank transfer',
  'Mobile wallet',
  'Other',
] as const;

type ExpenseSeed = Insertable<DatabaseSchema['expenses']>;
type SubscriptionSeed = Insertable<DatabaseSchema['subscriptions']>;
type SubscriptionPaymentSeed = Insertable<
  DatabaseSchema['subscription_payments']
>;
type DebtSeed = Insertable<DatabaseSchema['debts']>;
type DebtPaymentSeed = Insertable<DatabaseSchema['debt_payments']>;

export interface DemoSeedPlan {
  debtPayments: DebtPaymentSeed[];
  debts: DebtSeed[];
  expenses: ExpenseSeed[];
  subscriptionPayments: SubscriptionPaymentSeed[];
  subscriptions: SubscriptionSeed[];
}

interface DemoSeedOptions {
  categoryIds: Readonly<Record<string, string>>;
  ownerId: string;
  paymentMethodIds: Readonly<Record<string, string>>;
  year: number;
}

const expenseDescriptions = [
  'Grocery market',
  'City transport',
  'Online shopping',
  'Electricity bill',
  'Health appointment',
  'Apartment service',
  'Learning materials',
  'Weekend entertainment',
  'Business supplies',
] as const;

const merchants = [
  'Fresh Market',
  'Metro Connect',
  'Everyday Store',
  'City Utilities',
  'Wellness Clinic',
  'Home Services',
  'Learning Hub',
  'Stream & Play',
  'Office Corner',
] as const;

const subscriptionNames = [
  'Cloud Workspace',
  'Design Suite',
  'Video Streaming',
  'Music Membership',
  'Mobile Plan',
  'Fitness Club',
  'Learning Library',
  'Password Manager',
  'News Subscription',
  'Project Tracker',
] as const;

const debtNames = [
  'Equipment financing',
  'Family advance',
  'Vehicle installment',
  'Client reimbursement',
  'Home improvement loan',
  'Travel balance',
  'Education payment plan',
  'Business expense advance',
  'Medical payment plan',
  'Shared purchase balance',
] as const;

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(
    createHash('sha256').update(seed).digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function dateOnly(year: number, month: number, seed: number): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = ((seed * 7 + month * 3) % daysInMonth) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function timestamp(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

function amountFor(
  currencyCode: string,
  month: number,
  index: number,
  scale: number,
): string {
  const base = (month * 37 + (index + 1) * 19) * scale;
  const amount = currencyCode === 'JPY' ? base * 12 : base;
  return (amount / 10).toFixed(2);
}

function requireId(
  ids: Readonly<Record<string, string>>,
  name: string,
): string {
  const id = ids[name];
  if (!id) throw new Error(`Demo seed prerequisite is missing: ${name}`);
  return id;
}

export function buildDemoSeedPlan({
  categoryIds,
  ownerId,
  paymentMethodIds,
  year,
}: DemoSeedOptions): DemoSeedPlan {
  const expenses: ExpenseSeed[] = [];
  const subscriptions: SubscriptionSeed[] = [];
  const subscriptionPayments: SubscriptionPaymentSeed[] = [];
  const debts: DebtSeed[] = [];
  const debtPayments: DebtPaymentSeed[] = [];

  for (let month = 1; month <= 12; month += 1) {
    const count = DEMO_MONTH_COUNTS[month - 1] ?? 0;
    for (let index = 0; index < count; index += 1) {
      const currencyCode =
        DEMO_CURRENCIES[(month + index - 1) % DEMO_CURRENCIES.length] ?? 'USD';
      const categoryName =
        DEMO_CATEGORY_NAMES[(month + index - 1) % DEMO_CATEGORY_NAMES.length] ??
        'Other';
      const paymentMethodName =
        DEMO_PAYMENT_METHOD_NAMES[
          (month + index - 1) % DEMO_PAYMENT_METHOD_NAMES.length
        ] ?? 'Other';
      const recordDate = dateOnly(year, month, index);
      const expenseId = deterministicUuid(
        `bizziemoney-demo:expense:${ownerId}:${year}:${month}:${index}`,
      );
      const createdAt = timestamp(recordDate, 8 + (index % 10));

      expenses.push({
        amount: amountFor(currencyCode, month, index, 2),
        category_id: requireId(categoryIds, categoryName),
        created_at: createdAt,
        currency_code: currencyCode,
        description: `${expenseDescriptions[index % expenseDescriptions.length]} ${index + 1}`,
        expense_date: recordDate,
        id: expenseId,
        merchant: merchants[index % merchants.length] ?? 'Demo merchant',
        notes: `BizzieMoney demo seed - ${year} - expense`,
        owner_id: ownerId,
        payment_method_id: requireId(paymentMethodIds, paymentMethodName),
        updated_at: createdAt,
      });

      const subscriptionId = deterministicUuid(
        `bizziemoney-demo:subscription:${ownerId}:${year}:${month}:${index}`,
      );
      const subscriptionStatus =
        index % 17 === 0
          ? 'ended'
          : index % 13 === 0
            ? 'cancelled'
            : index % 11 === 0
              ? 'paused'
              : 'active';
      const billingFrequency =
        (['monthly', 'quarterly', 'yearly', 'semiannual', 'weekly'] as const)[
          index % 5
        ] ?? 'monthly';

      subscriptions.push({
        amount: amountFor(currencyCode, month, index, 1),
        auto_renew: subscriptionStatus === 'active' && index % 4 !== 0,
        billing_frequency: billingFrequency,
        category_id: requireId(categoryIds, categoryName),
        created_at: createdAt,
        currency_code: currencyCode,
        custom_interval_days: null,
        end_date:
          subscriptionStatus === 'ended' || subscriptionStatus === 'cancelled'
            ? recordDate
            : null,
        id: subscriptionId,
        name: `${subscriptionNames[index % subscriptionNames.length]} ${month}-${index + 1}`,
        next_payment_date: recordDate,
        notes: `BizzieMoney demo seed - ${year} - subscription`,
        owner_id: ownerId,
        reminder_days: index % 8,
        start_date: `${year}-${String(month).padStart(2, '0')}-01`,
        status: subscriptionStatus,
        updated_at: createdAt,
      });

      if (month <= 7 && index % 2 === 0) {
        subscriptionPayments.push({
          amount: amountFor(currencyCode, month, index, 1),
          converted_expense_id: null,
          created_at: createdAt,
          currency_code: currencyCode,
          id: deterministicUuid(
            `bizziemoney-demo:subscription-payment:${ownerId}:${year}:${month}:${index}`,
          ),
          owner_id: ownerId,
          paid_date: recordDate,
          scheduled_date: recordDate,
          subscription_id: subscriptionId,
          updated_at: createdAt,
        });
      }

      const debtId = deterministicUuid(
        `bizziemoney-demo:debt:${ownerId}:${year}:${month}:${index}`,
      );
      const direction = index % 2 === 0 ? 'i_owe' : 'owed_to_me';
      const originalAmount = amountFor(currencyCode, month, index, 18);
      const debtStatus =
        index % 19 === 0
          ? 'paid'
          : index % 17 === 0
            ? 'cancelled'
            : index % 13 === 0
              ? 'paused'
              : 'active';
      const hasInstallments = debtStatus === 'active' && index % 2 === 0;

      debts.push({
        completed_at: debtStatus === 'paid' ? timestamp(recordDate, 18) : null,
        created_at: createdAt,
        currency_code: currencyCode,
        custom_interval_days: null,
        direction,
        due_date: recordDate,
        id: debtId,
        installment_amount: hasInstallments
          ? amountFor(currencyCode, month, index, 2)
          : null,
        installment_frequency: hasInstallments ? 'monthly' : null,
        interest_note:
          index % 5 === 0 ? 'Fixed demo plan with no variable rate.' : null,
        name: `${debtNames[index % debtNames.length]} ${month}-${index + 1}`,
        next_payment_date: hasInstallments ? recordDate : null,
        notes: `BizzieMoney demo seed - ${year} - debt`,
        original_amount: originalAmount,
        owner_id: ownerId,
        start_date: `${year}-${String(month).padStart(2, '0')}-01`,
        status: debtStatus,
        updated_at: createdAt,
      });

      if (debtStatus === 'paid' || index % 3 === 0) {
        debtPayments.push({
          amount:
            debtStatus === 'paid'
              ? originalAmount
              : (Number(originalAmount) * 0.25).toFixed(2),
          created_at: createdAt,
          debt_id: debtId,
          id: deterministicUuid(
            `bizziemoney-demo:debt-payment:${ownerId}:${year}:${month}:${index}`,
          ),
          notes: `BizzieMoney demo seed - ${year} - debt payment`,
          owner_id: ownerId,
          payment_date: recordDate,
          updated_at: createdAt,
        });
      }
    }
  }

  return {
    debtPayments,
    debts,
    expenses,
    subscriptionPayments,
    subscriptions,
  };
}
