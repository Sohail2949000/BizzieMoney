create table expense_import_requests (
  owner_id uuid not null references app_users (id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null,
  imported_count integer not null check (imported_count > 0),
  currency_counts jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  check (jsonb_typeof(currency_counts) = 'object')
);

create index expense_import_requests_created_idx
  on expense_import_requests (created_at);

update app_meta
set
  application_version = '0.10.0',
  schema_version = 11,
  updated_at = now()
where id = 1;
