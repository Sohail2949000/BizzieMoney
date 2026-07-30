import { sql, type BizzieMoneyDatabase } from '@bizziemoney/database';

export interface SubscriptionMaintenanceResult {
  endedSubscriptions: number;
  readyReminders: number;
  staleReminders: number;
}

export interface SubscriptionMaintenanceStore {
  runMaintenance(): Promise<SubscriptionMaintenanceResult>;
}

export class PostgresSubscriptionMaintenanceStore implements SubscriptionMaintenanceStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async runMaintenance(): Promise<SubscriptionMaintenanceResult> {
    return this.database.transaction().execute(async (transaction) => {
      const lock = await sql<{ acquired: boolean }>`
        select pg_try_advisory_xact_lock(
          hashtextextended('bizziemoney-subscription-maintenance', 0)
        ) as acquired
      `.execute(transaction);
      if (!lock.rows[0]?.acquired) {
        return {
          endedSubscriptions: 0,
          readyReminders: 0,
          staleReminders: 0,
        };
      }

      const ended = await sql`
        update subscriptions s
        set
          status = 'ended',
          updated_at = now()
        from app_settings settings
        where settings.owner_id = s.owner_id
          and s.deleted_at is null
          and s.status = 'active'
          and s.end_date is not null
          and s.end_date
            < (now() at time zone settings.time_zone)::date
      `.execute(transaction);
      const stale = await sql`
        update subscription_reminders r
        set
          status = 'completed',
          updated_at = now()
        where r.status in ('pending', 'ready')
          and not exists (
            select 1
            from subscriptions s
            where s.owner_id = r.owner_id
              and s.id = r.subscription_id
              and s.deleted_at is null
              and s.status = 'active'
              and s.next_payment_date = r.payment_date
          )
      `.execute(transaction);
      const ready = await sql`
        update subscription_reminders r
        set
          status = 'ready',
          ready_at = coalesce(r.ready_at, now()),
          updated_at = now()
        from subscriptions s, app_settings settings
        where r.status = 'pending'
          and settings.owner_id = r.owner_id
          and r.remind_on
            <= (now() at time zone settings.time_zone)::date
          and s.owner_id = r.owner_id
          and s.id = r.subscription_id
          and s.deleted_at is null
          and s.status = 'active'
          and s.next_payment_date = r.payment_date
      `.execute(transaction);
      return {
        endedSubscriptions: Number(ended.numAffectedRows ?? 0),
        readyReminders: Number(ready.numAffectedRows ?? 0),
        staleReminders: Number(stale.numAffectedRows ?? 0),
      };
    });
  }
}

export class SubscriptionMaintenanceProcessor {
  constructor(private readonly store: SubscriptionMaintenanceStore) {}

  run(): Promise<SubscriptionMaintenanceResult> {
    return this.store.runMaintenance();
  }
}
