export const APP_NAME = 'BizzieMoney';
export const APP_VERSION = '1.0.0';
export const APP_SCHEMA_VERSION = 16;

export {
  nextBackupRun,
  type BackupFrequency,
  type BackupSchedule,
} from './backups';
export {
  DATE_FORMATS,
  DEFAULT_PREFERENCES,
  NUMBER_FORMATS,
  currentDateInTimeZone,
  currentMonthInTimeZone,
  isSupportedCurrency,
  isSupportedTimeZone,
  supportedCurrencyCodes,
  supportedTimeZones,
  type DateFormat,
  type NumberFormat,
  type OwnerPreferences,
} from './preferences';

export const navigationItems = [
  { label: 'Overview', path: '/' },
  { label: 'Expenses', path: '/expenses' },
  { label: 'Subscriptions', path: '/subscriptions' },
  { label: 'Loans & Debts', path: '/debts' },
  { label: 'Settings', path: '/settings' },
] as const;

export type NavigationItem = (typeof navigationItems)[number];
export type NavigationPath = NavigationItem['path'];

export const apiInfo = {
  name: 'bizziemoney-api',
  version: APP_VERSION,
} as const;
