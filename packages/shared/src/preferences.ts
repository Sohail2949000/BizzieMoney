export const DATE_FORMATS = [
  'MMM d, yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
] as const;

export const NUMBER_FORMATS = ['1,234.56', '1.234,56', '1 234,56'] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface OwnerPreferences {
  dateFormat: DateFormat;
  defaultCurrency: string;
  firstDayOfWeek: number;
  numberFormat: NumberFormat;
  timeZone: string;
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: OwnerPreferences = {
  dateFormat: 'MMM d, yyyy',
  defaultCurrency: 'USD',
  firstDayOfWeek: 0,
  numberFormat: '1,234.56',
  timeZone: 'Asia/Riyadh',
  updatedAt: '',
};

let currencies: readonly string[] | undefined;
let timeZones: readonly string[] | undefined;

export function supportedCurrencyCodes(): readonly string[] {
  currencies ??= Intl.supportedValuesOf('currency');
  return currencies;
}

export function supportedTimeZones(): readonly string[] {
  timeZones ??= [
    'UTC',
    ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC'),
  ];
  return timeZones;
}

export function isSupportedCurrency(value: string): boolean {
  return supportedCurrencyCodes().includes(value);
}

export function isSupportedTimeZone(value: string): boolean {
  if (value === 'UTC') return true;
  return supportedTimeZones().includes(value);
}

function dateParts(
  value: Date,
  timeZone: string,
): {
  day: string;
  month: string;
  year: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    day: part('day'),
    month: part('month'),
    year: part('year'),
  };
}

export function currentDateInTimeZone(value: Date, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentMonthInTimeZone(value: Date, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}`;
}
