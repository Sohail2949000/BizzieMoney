import { describe, expect, it } from 'vitest';

import { readWorkerConfig } from './config';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://owner:secret@localhost:5432/bizziemoney',
  SESSION_SECRET: 's'.repeat(64),
};

describe('worker configuration', () => {
  it('rejects unsafe short heartbeat intervals', () => {
    expect(() =>
      readWorkerConfig({
        ...requiredEnvironment,
        WORKER_HEARTBEAT_INTERVAL_MS: '100',
      }),
    ).toThrow();
  });

  it('provides a bounded attachment cleanup cadence', () => {
    const config = readWorkerConfig(requiredEnvironment);
    expect(config.ATTACHMENT_CLEANUP_INTERVAL_MS).toBe(5_000);
    expect(() =>
      readWorkerConfig({
        ...requiredEnvironment,
        ATTACHMENT_CLEANUP_INTERVAL_MS: '100',
      }),
    ).toThrow();
  });

  it('provides a bounded subscription reminder cadence', () => {
    const config = readWorkerConfig(requiredEnvironment);
    expect(config.SUBSCRIPTION_REMINDER_INTERVAL_MS).toBe(60_000);
    expect(() =>
      readWorkerConfig({
        ...requiredEnvironment,
        SUBSCRIPTION_REMINDER_INTERVAL_MS: '100',
      }),
    ).toThrow();
  });

  it('provides bounded expired-session maintenance defaults', () => {
    const config = readWorkerConfig(requiredEnvironment);
    expect(config.SESSION_MAINTENANCE_INTERVAL_MS).toBe(6 * 60 * 60_000);
    expect(config.SESSION_RETENTION_DAYS).toBe(30);
    expect(() =>
      readWorkerConfig({
        ...requiredEnvironment,
        SESSION_MAINTENANCE_INTERVAL_MS: '1000',
      }),
    ).toThrow();
  });

  it('uses the session secret when the optional backup key is blank', () => {
    expect(
      readWorkerConfig({
        ...requiredEnvironment,
        BACKUP_SECRETS_KEY: '',
      }).BACKUP_SECRETS_KEY,
    ).toBeUndefined();
  });
});
