create index subscriptions_owner_amount_active_idx
  on subscriptions (owner_id, amount desc, id desc)
  where deleted_at is null;

create index subscriptions_owner_updated_active_idx
  on subscriptions (owner_id, updated_at desc, id desc)
  where deleted_at is null;

create index debts_owner_direction_due_active_idx
  on debts (
    owner_id,
    direction,
    (coalesce(next_payment_date, due_date, '9999-12-31'::date)),
    id
  )
  where deleted_at is null;

create index backup_jobs_owner_active_idx
  on backup_jobs (owner_id, created_at desc, id desc)
  where status in ('queued', 'processing');

update app_meta
set
  application_version = '0.8.0',
  schema_version = 9,
  updated_at = now()
where id = 1;
