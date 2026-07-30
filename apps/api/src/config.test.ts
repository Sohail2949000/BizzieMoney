import { describe, expect, it } from 'vitest';

import { readApiConfig } from './config';

const requiredEnvironment = {
  APP_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://owner:secret@localhost:5432/bizziemoney',
  SESSION_SECRET: 's'.repeat(64),
};

describe('API configuration', () => {
  it('uses the session secret when the optional backup key is blank', () => {
    expect(
      readApiConfig({
        ...requiredEnvironment,
        BACKUP_SECRETS_KEY: '',
      }).BACKUP_SECRETS_KEY,
    ).toBeUndefined();
  });

  it('keeps malware scanning opt-in and validates ClamAV connection settings', () => {
    const config = readApiConfig(requiredEnvironment);
    expect(config.ATTACHMENT_MALWARE_SCANNER).toBe('disabled');
    expect(config.CLAMAV_PORT).toBe(3310);
    expect(() =>
      readApiConfig({
        ...requiredEnvironment,
        ATTACHMENT_MALWARE_SCANNER: 'clamav',
        CLAMAV_TIMEOUT_MS: '100',
      }),
    ).toThrow();
  });

  it('rejects a separately configured backup key that is too short', () => {
    expect(() =>
      readApiConfig({
        ...requiredEnvironment,
        BACKUP_SECRETS_KEY: 'too-short',
      }),
    ).toThrow();
  });

  it('normalizes and deduplicates exact application origins', () => {
    const config = readApiConfig({
      ...requiredEnvironment,
      APP_ALLOWED_ORIGINS:
        'http://localhost:5173/, https://money.example.com, https://money.example.com/',
    });

    expect(config.APP_ALLOWED_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://money.example.com',
    ]);
  });

  it.each([
    '*',
    'https://*.example.com',
    'https://money.example.com/private',
    'https://money.example.com?source=tunnel',
    'ftp://money.example.com',
    'not-an-origin',
  ])('rejects unsafe or malformed allowed origin %s', (origin) => {
    expect(() =>
      readApiConfig({
        ...requiredEnvironment,
        APP_ALLOWED_ORIGINS: origin,
      }),
    ).toThrow();
  });
});
