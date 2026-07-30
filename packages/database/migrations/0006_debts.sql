create table debts (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  direction text not null
    check (direction in ('i_owe', 'owed_to_me')),
  name text not null check (char_length(name) between 1 and 160),
  original_amount numeric(19,4) not null check (original_amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  start_date date not null,
  due_date date,
  installment_amount numeric(19,4)
    check (installment_amount is null or installment_amount > 0),
  installment_frequency text
    check (
      installment_frequency is null
      or installment_frequency in (
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
  next_payment_date date,
  interest_note text
    check (interest_note is null or char_length(interest_note) <= 1000),
  status text not null default 'active'
    check (status in ('active', 'paid', 'overdue', 'paused', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 5000),
  completed_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(name, '') || ' ' ||
      coalesce(interest_note, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, id),
  check (due_date is null or due_date >= start_date),
  check (next_payment_date is null or next_payment_date >= start_date),
  check (
    (
      installment_amount is null
      and installment_frequency is null
      and custom_interval_days is null
      and next_payment_date is null
    )
    or
    (
      installment_amount is not null
      and installment_frequency is not null
      and next_payment_date is not null
      and (
        (installment_frequency = 'custom' and custom_interval_days is not null)
        or
        (installment_frequency <> 'custom' and custom_interval_days is null)
      )
    )
  ),
  check (
    (status = 'paid' and completed_at is not null)
    or
    (status <> 'paid' and completed_at is null)
  )
);

create index debts_owner_direction_status_due_active_idx
  on debts (
    owner_id,
    direction,
    status,
    (coalesce(next_payment_date, due_date)),
    id
  )
  where deleted_at is null;

create index debts_owner_updated_active_idx
  on debts (owner_id, updated_at desc, id desc)
  where deleted_at is null;

create index debts_search_idx
  on debts using gin (search_vector);

create table debt_payments (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  debt_id uuid not null,
  payment_date date not null,
  amount numeric(19,4) not null check (amount > 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, id),
  foreign key (owner_id, debt_id)
    references debts(owner_id, id)
);

create index debt_payments_owner_debt_date_active_idx
  on debt_payments (owner_id, debt_id, payment_date desc, id desc)
  where deleted_at is null;

create index debt_payments_debt_fk_idx
  on debt_payments (debt_id);

create table debt_payment_requests (
  owner_id uuid not null references app_users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  payment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  foreign key (owner_id, payment_id)
    references debt_payments(owner_id, id)
    deferrable initially deferred
);

create index debt_payment_requests_created_idx
  on debt_payment_requests (created_at);

alter table entity_attachments
  drop constraint entity_attachments_entity_type_check;

alter table entity_attachments
  add constraint entity_attachments_entity_type_check
  check (
    entity_type in ('expense', 'subscription', 'debt', 'debt_payment')
  );

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

  if new.entity_type = 'debt' then
    if not exists (
      select 1
      from debts
      where owner_id = new.owner_id
        and id = new.entity_id
        and deleted_at is null
    ) then
      raise exception 'attachment entity is unavailable';
    end if;
    return new;
  end if;

  if new.entity_type = 'debt_payment' then
    if not exists (
      select 1
      from debt_payments
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
  application_version = '0.6.0',
  schema_version = 6,
  updated_at = now()
where id = 1;
