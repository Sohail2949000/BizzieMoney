import type { BillingFrequency } from './types.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(value: string): {
  day: number;
  monthIndex: number;
  year: number;
} {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('SUBSCRIPTION_DATE_INVALID');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    throw new Error('SUBSCRIPTION_DATE_INVALID');
  }
  return { day, monthIndex, year };
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const parts = dateParts(value);
  return dateString(
    new Date(Date.UTC(parts.year, parts.monthIndex, parts.day + days)),
  );
}

function addMonths(value: string, months: number): string {
  const parts = dateParts(value);
  const targetMonthStart = new Date(
    Date.UTC(parts.year, parts.monthIndex + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return dateString(
    new Date(
      Date.UTC(
        targetMonthStart.getUTCFullYear(),
        targetMonthStart.getUTCMonth(),
        Math.min(parts.day, lastDay),
      ),
    ),
  );
}

export function isCalendarDate(value: string): boolean {
  try {
    dateParts(value);
    return true;
  } catch {
    return false;
  }
}

export function nextBillingDate(
  currentDate: string,
  frequency: BillingFrequency,
  customIntervalDays: number | null,
): string {
  switch (frequency) {
    case 'weekly':
      return addDays(currentDate, 7);
    case 'monthly':
      return addMonths(currentDate, 1);
    case 'quarterly':
      return addMonths(currentDate, 3);
    case 'semiannual':
      return addMonths(currentDate, 6);
    case 'yearly':
      return addMonths(currentDate, 12);
    case 'custom':
      if (!customIntervalDays) {
        throw new Error('SUBSCRIPTION_CUSTOM_INTERVAL_REQUIRED');
      }
      return addDays(currentDate, customIntervalDays);
  }
}

export function reminderDate(
  paymentDate: string,
  reminderDays: number,
): string {
  return addDays(paymentDate, -reminderDays);
}

export function dateAfter(value: string, days: number): string {
  return addDays(value, days);
}
