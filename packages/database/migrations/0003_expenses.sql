create table categories (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  normalized_name text not null
    check (
      normalized_name = lower(normalized_name)
      and char_length(normalized_name) between 1 and 60
    ),
  icon text not null check (char_length(icon) between 1 and 40),
  color char(7) not null check (color ~ '^#[0-9A-F]{6}$'),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name),
  unique (owner_id, id)
);

create index categories_owner_active_name_idx
  on categories (owner_id, normalized_name)
  where is_archived = false;

create table payment_methods (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  normalized_name text not null
    check (
      normalized_name = lower(normalized_name)
      and char_length(normalized_name) between 1 and 60
    ),
  icon text not null check (char_length(icon) between 1 and 40),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name),
  unique (owner_id, id)
);

create index payment_methods_owner_active_name_idx
  on payment_methods (owner_id, normalized_name)
  where is_archived = false;

create table tags (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  normalized_name text not null
    check (
      normalized_name = lower(normalized_name)
      and char_length(normalized_name) between 1 and 40
    ),
  created_at timestamptz not null default now(),
  unique (owner_id, normalized_name),
  unique (owner_id, id)
);

create table expenses (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  expense_date date not null,
  description text not null check (char_length(description) between 1 and 160),
  amount numeric(19,4) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  category_id uuid not null,
  payment_method_id uuid not null,
  merchant text check (
    merchant is null
    or char_length(merchant) between 1 and 120
  ),
  notes text check (notes is null or char_length(notes) <= 5000),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(description, '') || ' ' ||
      coalesce(merchant, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, id),
  foreign key (owner_id, category_id)
    references categories(owner_id, id),
  foreign key (owner_id, payment_method_id)
    references payment_methods(owner_id, id)
);

create index expenses_owner_date_id_active_idx
  on expenses (owner_id, expense_date desc, id desc)
  where deleted_at is null;

create index expenses_owner_category_date_active_idx
  on expenses (owner_id, category_id, expense_date desc, id desc)
  where deleted_at is null;

create index expenses_owner_payment_date_active_idx
  on expenses (owner_id, payment_method_id, expense_date desc, id desc)
  where deleted_at is null;

create index expenses_owner_amount_id_active_idx
  on expenses (owner_id, amount desc, id desc)
  where deleted_at is null;

create index expenses_owner_updated_id_active_idx
  on expenses (owner_id, updated_at desc, id desc)
  where deleted_at is null;

create index expenses_search_idx on expenses using gin (search_vector);

create table expense_tags (
  owner_id uuid not null references app_users(id) on delete cascade,
  expense_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (expense_id, tag_id),
  foreign key (owner_id, expense_id)
    references expenses(owner_id, id) on delete cascade,
  foreign key (owner_id, tag_id)
    references tags(owner_id, id) on delete cascade
);

create index expense_tags_owner_tag_idx
  on expense_tags (owner_id, tag_id, expense_id);

create table expense_creation_requests (
  owner_id uuid not null references app_users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null,
  expense_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  foreign key (owner_id, expense_id)
    references expenses(owner_id, id)
    deferrable initially deferred
);

create index expense_creation_requests_created_idx
  on expense_creation_requests (created_at);

create function seed_owner_expense_defaults(target_owner_id uuid)
returns void
language plpgsql
as $$
begin
  insert into categories (
    id,
    owner_id,
    name,
    normalized_name,
    icon,
    color
  )
  values
    (gen_random_uuid(), target_owner_id, 'Food & Dining', 'food & dining', 'utensils', '#16A36A'),
    (gen_random_uuid(), target_owner_id, 'Transport', 'transport', 'car', '#3B82F6'),
    (gen_random_uuid(), target_owner_id, 'Shopping', 'shopping', 'shopping-bag', '#8B5CF6'),
    (gen_random_uuid(), target_owner_id, 'Bills & Utilities', 'bills & utilities', 'receipt', '#D97706'),
    (gen_random_uuid(), target_owner_id, 'Health', 'health', 'heart-pulse', '#E5484D'),
    (gen_random_uuid(), target_owner_id, 'Housing', 'housing', 'house', '#6366F1'),
    (gen_random_uuid(), target_owner_id, 'Education', 'education', 'graduation-cap', '#0891B2'),
    (gen_random_uuid(), target_owner_id, 'Entertainment', 'entertainment', 'ticket', '#DB2777'),
    (gen_random_uuid(), target_owner_id, 'Other', 'other', 'circle-ellipsis', '#71717A')
  on conflict (owner_id, normalized_name) do nothing;

  insert into payment_methods (
    id,
    owner_id,
    name,
    normalized_name,
    icon
  )
  values
    (gen_random_uuid(), target_owner_id, 'Cash', 'cash', 'banknote'),
    (gen_random_uuid(), target_owner_id, 'Bank card', 'bank card', 'credit-card'),
    (gen_random_uuid(), target_owner_id, 'Bank transfer', 'bank transfer', 'landmark'),
    (gen_random_uuid(), target_owner_id, 'Mobile wallet', 'mobile wallet', 'smartphone'),
    (gen_random_uuid(), target_owner_id, 'Other', 'other', 'circle-ellipsis')
  on conflict (owner_id, normalized_name) do nothing;
end;
$$;

select seed_owner_expense_defaults(id) from app_users;

update app_meta
set
  application_version = '0.3.0',
  schema_version = 3,
  updated_at = now()
where id = 1;
