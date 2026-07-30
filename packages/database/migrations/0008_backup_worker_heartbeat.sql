create table if not exists worker_heartbeats (
  worker_name text primary key
    check (char_length(worker_name) between 1 and 80),
  status text not null default 'online'
    check (status in ('online', 'degraded')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

update app_meta
set
  application_version = '0.7.0',
  schema_version = 8,
  updated_at = now()
where id = 1;
