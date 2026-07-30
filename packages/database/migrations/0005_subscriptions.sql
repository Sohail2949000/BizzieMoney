create table subscriptions (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  amount numeric(19,4) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  billing_frequency text not null
    check (
      billing_frequency in (
        'weekly',
        'monthly',
        'quarterly',
        'semiannual',
        'yearly',
        'custom'
      )
    ),
  custom_interval_days integer
    check (
      custom_interval_days is null
      or custom_interval_days between 1 and 3650
    ),
  next_payment_date date not null,
  category_id uuid not null,
  auto_renew boolean not null default true,
  reminder_days integer not null default 3
    check (reminder_days between 0 and 365),
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled', 'ended')),
  start_date date,
  end_date date,
  notes text check (notes is null or char_length(notes) <= 5000),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(name, '') || ' ' || coalesce(notes, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, id),
  foreign key (owner_id, category_id)
    references categories(owner_id, id),
  check (
    (billing_frequency = 'custom' and custom_interval_days is not null)
    or
    (billing_frequency <> 'custom' and custom_interval_days is null)
  ),
  check (start_date is null or next_payment_date >= start_date),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index subscriptions_owner_status_next_active_idx
  on subscriptions (owner_id, status, next_payment_date, id)
  where deleted_at is null;

create index subscriptions_owner_next_active_idx
  on subscriptions (owner_id, next_payment_date, id)
  where deleted_at is null;

create index subscriptions_owner_category_next_active_idx
  on subscriptions (owner_id, category_id, next_payment_date, id)
  where deleted_at is null;

create index subscriptions_search_idx
  on subscriptions using gin (search_vector);

create table subscription_payments (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  subscription_id uuid not null,
  scheduled_date date not null,
  paid_date date not null,
  amount numeric(19,4) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  converted_expense_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, subscription_id, scheduled_date),
  unique (owner_id, converted_expense_id),
  foreign key (owner_id, subscription_id)
    references subscriptions(owner_id, id),
  foreign key (owner_id, converted_expense_id)
    references expenses(owner_id, id)
    deferrable initially deferred
);

create index subscription_payments_owner_subscription_paid_idx
  on subscription_payments (owner_id, subscription_id, paid_date desc, id desc);

create index subscription_payments_subscription_fk_idx
  on subscription_payments (subscription_id);

create table subscription_payment_requests (
  owner_id uuid not null references app_users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  payment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  foreign key (owner_id, payment_id)
    references subscription_payments(owner_id, id)
    deferrable initially deferred
);

create index subscription_payment_requests_created_idx
  on subscription_payment_requests (created_at);

create table subscription_conversion_requests (
  owner_id uuid not null references app_users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  payment_id uuid not null,
  expense_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  foreign key (owner_id, payment_id)
    references subscription_payments(owner_id, id),
  foreign key (owner_id, expense_id)
    references expenses(owner_id, id)
    deferrable initially deferred
);

create index subscription_conversion_requests_created_idx
  on subscription_conversion_requests (created_at);

create table subscription_reminders (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  subscription_id uuid not null,
  payment_date date not null,
  remind_on date not null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'dismissed', 'completed')),
  ready_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, subscription_id, payment_date),
  foreign key (owner_id, subscription_id)
    references subscriptions(owner_id, id) on delete cascade
);

create index subscription_reminders_claim_idx
  on subscription_reminders (remind_on, created_at, id)
  where status = 'pending';

create index subscription_reminders_owner_ready_idx
  on subscription_reminders (owner_id, payment_date, id)
  where status = 'ready';

create index subscription_reminders_subscription_fk_idx
  on subscription_reminders (subscription_id);

alter table entity_attachments
  drop constraint entity_attachments_entity_type_check;

alter table entity_attachments
  add constraint entity_attachments_entity_type_check
  check (entity_type in ('expense', 'subscription'));

create or replace function validate_entity_attachment()
returns trigger
language plpgsql
as $$
begin
  if new.entity_type = 'expense' then
    if not exists (
      select 1
      from expenses
      where owner_id = new.owner_id
        and id = new.entity_id
        and deleted_at is null
    ) then
      raise exception 'attachment entity is unavailable';
    end if;
    return new;
  end if;

  if new.entity_type = 'subscription' then
    if not exists (
      select 1
      from subscriptions
      where owner_id = new.owner_id
        and id = new.entity_id
        and deleted_at is null
    ) then
      raise exception 'attachment entity is unavailable';
    end if;
    return new;
  end if;

  raise exception 'attachment entity type is unsupported';
end;
$$;

update app_meta
set
  application_version = '0.5.0',
  schema_version = 5,
  updated_at = now()
where id = 1;
