import { sql, type BizzieMoneyDatabase } from '@bizziemoney/database';

export interface DebtMaintenanceResult {
  activatedDebts: number;
  overdueDebts: number;
}

export interface DebtMaintenanceStore {
  runMaintenance(): Promise<DebtMaintenanceResult>;
}

export class PostgresDebtMaintenanceStore implements DebtMaintenanceStore {
  constructor(private readonly database: BizzieMoneyDatabase) {}

  async runMaintenance(): Promise<DebtMaintenanceResult> {
    return this.database.transaction().execute(async (transaction) => {
      const lock = await sql<{ acquired: boolean }>`
        select pg_try_advisory_xact_lock(
          hashtextextended('bizziemoney-debt-maintenance', 0)
        ) as acquired
      `.execute(transaction);
      if (!lock.rows[0]?.acquired) {
        return { activatedDebts: 0, overdueDebts: 0 };
      }
      const overdue = await sql`
        update debts d
        set status = 'overdue', updated_at = now()
        from app_settings settings
        where settings.owner_id = d.owner_id
          and d.deleted_at is null
          and d.status = 'active'
          and coalesce(d.next_payment_date, d.due_date)
            < (now() at time zone settings.time_zone)::date
      `.execute(transaction);
      const activated = await sql`
        update debts d
        set status = 'active', updated_at = now()
        from app_settings settings
        where settings.owner_id = d.owner_id
          and d.deleted_at is null
          and d.status = 'overdue'
          and (
            coalesce(d.next_payment_date, d.due_date) is null
            or coalesce(d.next_payment_date, d.due_date)
              >= (now() at time zone settings.time_zone)::date
          )
      `.execute(transaction);
      return {
        activatedDebts: Number(activated.numAffectedRows ?? 0),
        overdueDebts: Number(overdue.numAffectedRows ?? 0),
      };
    });
  }
}

export class DebtMaintenanceProcessor {
  constructor(private readonly store: DebtMaintenanceStore) {}

  run(): Promise<DebtMaintenanceResult> {
    return this.store.runMaintenance();
  }
}
