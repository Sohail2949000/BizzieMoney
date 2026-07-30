import type { Page } from '@playwright/test';

export interface MockOwnerPreferences {
  dateFormat: 'MMM d, yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd';
  defaultCurrency: string;
  firstDayOfWeek: number;
  numberFormat: '1,234.56' | '1.234,56' | '1 234,56';
  timeZone: string;
  updatedAt: string;
}

export const defaultOwnerPreferences: MockOwnerPreferences = {
  dateFormat: 'MMM d, yyyy',
  defaultCurrency: 'USD',
  firstDayOfWeek: 0,
  numberFormat: '1,234.56',
  timeZone: 'Asia/Riyadh',
  updatedAt: '2026-07-28T09:00:00.000Z',
};

export async function mockOwnerPreferences(
  page: Page,
  initial: MockOwnerPreferences = defaultOwnerPreferences,
): Promise<() => MockOwnerPreferences> {
  let current = { ...initial };

  await page.route('**/api/settings/preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      current = {
        ...current,
        ...(route.request().postDataJSON() as Partial<MockOwnerPreferences>),
        updatedAt: '2026-07-28T09:05:00.000Z',
      };
    }
    await route.fulfill({
      contentType: 'application/json',
      json: current,
    });
  });

  return () => current;
}
