import {
  currentDateInTimeZone,
  currentMonthInTimeZone,
  type OwnerPreferences,
} from '@bizziemoney/shared';

const numberLocales: Record<OwnerPreferences['numberFormat'], string> = {
  '1 234,56': 'fr-FR',
  '1,234.56': 'en-US',
  '1.234,56': 'de-DE',
};

function parseDateOnly(value: string): {
  day: string;
  month: string;
  year: string;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error('DATE_ONLY_INVALID');
  }
  return { day: match[3], month: match[2], year: match[1] };
}

function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`2026-${month}-01T12:00:00.000Z`));
}

export function formatDateOnly(
  value: string,
  dateFormat: OwnerPreferences['dateFormat'],
): string {
  const { day, month, year } = parseDateOnly(value);
  switch (dateFormat) {
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'MM/dd/yyyy':
      return `${month}/${day}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'MMM d, yyyy':
      return `${monthName(month)} ${Number(day)}, ${year}`;
  }
}

export function createPreferenceFormatters(preferences: OwnerPreferences) {
  const locale = numberLocales[preferences.numberFormat];
  return {
    currentMonth: (value = new Date()) =>
      currentMonthInTimeZone(value, preferences.timeZone),
    formatDate: (value: string) =>
      formatDateOnly(value, preferences.dateFormat),
    formatDateTime: (value: string | Date | null) => {
      if (!value) return 'Not scheduled';
      const date = value instanceof Date ? value : new Date(value);
      const dateOnly = currentDateInTimeZone(date, preferences.timeZone);
      const time = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: preferences.timeZone,
      }).format(date);
      return `${formatDateOnly(dateOnly, preferences.dateFormat)}, ${time}`;
    },
    formatMoney: (amount: string, currencyCode: string) =>
      new Intl.NumberFormat(locale, {
        currency: currencyCode,
        maximumFractionDigits: 4,
        style: 'currency',
      }).format(Number(amount)),
    todayDate: (value = new Date()) =>
      currentDateInTimeZone(value, preferences.timeZone),
  };
}

export type PreferenceFormatters = ReturnType<
  typeof createPreferenceFormatters
>;
