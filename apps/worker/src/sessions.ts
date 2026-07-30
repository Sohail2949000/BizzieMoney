import type { BizzieMoneyDatabase } from '@bizziemoney/database';

const DAY_MILLISECONDS = 24 * 60 * 60_000;

export interface SessionMaintenanceResult {
  rateLimitsPruned: number;
  sessionsPruned: number;
}

export interface SessionMaintenanceStore {
  prune(cutoff: Date): Promise<SessionMaintenanceResult>;
}

export class PostgresSessionMaintenanceStore implements SessionMaintenanceStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async prune(cutoff: Date): Promise<SessionMaintenanceResult> {
    return this.database.transaction().execute(async (transaction) => {
      const sessions = await transaction
        .deleteFrom('sessions')
        .where((expression) =>
          expression.or([
            expression('expires_at', '<=', cutoff),
            expression.and([
              expression('revoked_at', 'is not', null),
              expression('revoked_at', '<=', cutoff),
            ]),
          ]),
        )
        .executeTakeFirst();
      const rateLimits = await transaction
        .deleteFrom('auth_rate_limits')
        .where('updated_at', '<=', cutoff)
        .executeTakeFirst();
      return {
        rateLimitsPruned: Number(rateLimits.numDeletedRows),
        sessionsPruned: Number(sessions.numDeletedRows),
      };
    });
  }
}

export class SessionMaintenanceProcessor {
  constructor(
    private readonly store: SessionMaintenanceStore,
    private readonly retentionDays: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  run(): Promise<SessionMaintenanceResult> {
    const cutoff = new Date(
      this.now().getTime() - this.retentionDays * DAY_MILLISECONDS,
    );
    return this.store.prune(cutoff);
  }
}
