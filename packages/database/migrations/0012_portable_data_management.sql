create table financial_purge_requests (
  owner_id uuid not null references app_users (id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  check (
    (result is null and completed_at is null)
    or
    (jsonb_typeof(result) = 'object' and completed_at is not null)
  )
);

create index financial_purge_requests_created_idx
  on financial_purge_requests (created_at);

update app_meta
set
  application_version = '0.11.0',
  schema_version = 12,
  updated_at = now()
where id = 1;
