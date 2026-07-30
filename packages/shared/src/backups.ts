import { Temporal } from '@js-temporal/polyfill';

export type BackupFrequency = 'daily' | 'monthly' | 'weekly';

export interface BackupSchedule {
  backupTime: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  frequency: BackupFrequency;
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('BACKUP_TIME_INVALID');
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function atTime(
  date: Temporal.PlainDate,
  hours: number,
  minutes: number,
  timeZone: string,
): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(
    {
      day: date.day,
      hour: hours,
      minute: minutes,
      month: date.month,
      timeZone,
      year: date.year,
    },
    { disambiguation: 'compatible' },
  );
}

function toDate(value: Temporal.ZonedDateTime): Date {
  return new Date(value.epochMilliseconds);
}

export function nextBackupRun(
  schedule: BackupSchedule,
  after: Date,
  timeZone: string,
): Date {
  const { hours, minutes } = parseTime(schedule.backupTime);
  const afterInstant = Temporal.Instant.fromEpochMilliseconds(after.getTime());
  const afterZoned = afterInstant.toZonedDateTimeISO(timeZone);

  if (schedule.frequency === 'daily') {
    let candidate = atTime(afterZoned.toPlainDate(), hours, minutes, timeZone);
    if (Temporal.Instant.compare(candidate.toInstant(), afterInstant) <= 0) {
      candidate = atTime(
        afterZoned.toPlainDate().add({ days: 1 }),
        hours,
        minutes,
        timeZone,
      );
    }
    return toDate(candidate);
  }

  if (schedule.frequency === 'weekly') {
    if (schedule.dayOfWeek === null) throw new Error('BACKUP_DAY_INVALID');
    const today = afterZoned.toPlainDate();
    const currentDayOfWeek = today.dayOfWeek % 7;
    const daysAhead = (schedule.dayOfWeek - currentDayOfWeek + 7) % 7;
    let candidate = atTime(
      today.add({ days: daysAhead }),
      hours,
      minutes,
      timeZone,
    );
    if (Temporal.Instant.compare(candidate.toInstant(), afterInstant) <= 0) {
      candidate = atTime(
        candidate.toPlainDate().add({ days: 7 }),
        hours,
        minutes,
        timeZone,
      );
    }
    return toDate(candidate);
  }

  if (schedule.dayOfMonth === null) throw new Error('BACKUP_DAY_INVALID');
  let candidateDate = Temporal.PlainDate.from({
    day: schedule.dayOfMonth,
    month: afterZoned.month,
    year: afterZoned.year,
  });
  let candidate = atTime(candidateDate, hours, minutes, timeZone);
  if (Temporal.Instant.compare(candidate.toInstant(), afterInstant) <= 0) {
    candidateDate = candidateDate
      .with({ day: 1 })
      .add({ months: 1 })
      .with({ day: schedule.dayOfMonth });
    candidate = atTime(candidateDate, hours, minutes, timeZone);
  }
  return toDate(candidate);
}
