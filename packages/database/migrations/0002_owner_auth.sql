create table app_users (
  id uuid primary key,
  owner_slot smallint not null default 1 unique check (owner_slot = 1),
  email text not null check (char_length(email) between 3 and 254),
  normalized_email text not null unique
    check (
      normalized_email = lower(normalized_email)
      and char_length(normalized_email) between 3 and 254
    ),
  display_name text not null check (char_length(display_name) between 2 and 80),
  password_hash text not null check (password_hash like '$argon2id$%'),
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_settings (
  owner_id uuid primary key references app_users(id) on delete cascade,
  default_currency char(3) not null default 'USD'
    check (default_currency ~ '^[A-Z]{3}$'),
  date_format text not null default 'MMM d, yyyy',
  first_day_of_week smallint not null default 0
    check (first_day_of_week between 0 and 6),
  time_zone text not null default 'Asia/Riyadh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  token_hash char(64) not null unique,
  csrf_token_hash char(64) not null,
  user_agent text not null check (char_length(user_agent) <= 512),
  ip_hash char(64) not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null
    or revoke_reason in (
      'logout',
      'logout_others',
      'logout_all',
      'password_changed',
      'expired'
    )
  ),
  check (expires_at > created_at),
  check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null)
  )
);

create index sessions_owner_active_idx
  on sessions (owner_id, expires_at desc, last_seen_at desc)
  where revoked_at is null;

create table auth_rate_limits (
  key_hash char(64) primary key,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null,
  blocked_until timestamptz,
  updated_at timestamptz not null
);

create index auth_rate_limits_updated_idx
  on auth_rate_limits (updated_at);

create table audit_events (
  id uuid primary key,
  owner_id uuid references app_users(id) on delete set null,
  actor_session_id uuid references sessions(id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 80),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_owner_created_idx
  on audit_events (owner_id, created_at desc);

create function prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;

create trigger audit_events_append_only
before update or delete on audit_events
for each row execute function prevent_audit_event_mutation();

update app_meta
set
  application_version = '0.2.0',
  schema_version = 2,
  updated_at = now()
where id = 1;
