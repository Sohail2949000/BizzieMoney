import { describe, expect, it } from 'vitest';

import { nextBackupRun } from './backups';

describe('nextBackupRun', () => {
  it('calculates daily, weekly, and monthly schedules without drift', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');

    expect(
      nextBackupRun(
        {
          backupTime: '02:30',
          dayOfMonth: null,
          dayOfWeek: null,
          frequency: 'daily',
        },
        now,
        'UTC',
      ),
    ).toEqual(new Date('2026-07-29T02:30:00.000Z'));

    expect(
      nextBackupRun(
        {
          backupTime: '09:00',
          dayOfMonth: null,
          dayOfWeek: 2,
          frequency: 'weekly',
        },
        now,
        'UTC',
      ),
    ).toEqual(new Date('2026-08-04T09:00:00.000Z'));

    expect(
      nextBackupRun(
        {
          backupTime: '03:15',
          dayOfMonth: 15,
          dayOfWeek: null,
          frequency: 'monthly',
        },
        now,
        'UTC',
      ),
    ).toEqual(new Date('2026-08-15T03:15:00.000Z'));
  });

  it('uses compatible DST disambiguation for skipped and repeated times', () => {
    expect(
      nextBackupRun(
        {
          backupTime: '02:30',
          dayOfMonth: null,
          dayOfWeek: null,
          frequency: 'daily',
        },
        new Date('2026-03-08T05:00:00.000Z'),
        'America/New_York',
      ),
    ).toEqual(new Date('2026-03-08T07:30:00.000Z'));

    expect(
      nextBackupRun(
        {
          backupTime: '01:30',
          dayOfMonth: null,
          dayOfWeek: null,
          frequency: 'daily',
        },
        new Date('2026-11-01T04:00:00.000Z'),
        'America/New_York',
      ),
    ).toEqual(new Date('2026-11-01T05:30:00.000Z'));
  });
});
