create table attachments (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  storage_provider text not null
    check (storage_provider in ('local', 's3')),
  storage_root text not null
    check (char_length(storage_root) between 1 and 512),
  object_key text not null
    check (
      char_length(object_key) between 1 and 512
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '^/'
    ),
  original_file_name text not null
    check (char_length(original_file_name) between 1 and 255),
  display_name text not null
    check (char_length(display_name) between 1 and 160),
  mime_type text not null
    check (char_length(mime_type) between 3 and 120),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 char(64) not null
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, id),
  unique (storage_provider, storage_root, object_key)
);

create index attachments_owner_created_active_idx
  on attachments (owner_id, created_at desc, id desc)
  where deleted_at is null;

create index attachments_owner_checksum_active_idx
  on attachments (owner_id, checksum_sha256)
  where deleted_at is null;

create table entity_attachments (
  owner_id uuid not null references app_users(id) on delete cascade,
  attachment_id uuid not null,
  entity_type text not null check (entity_type = 'expense'),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (entity_type, entity_id, attachment_id),
  foreign key (owner_id, attachment_id)
    references attachments(owner_id, id) on delete cascade
);

create index entity_attachments_owner_entity_idx
  on entity_attachments (owner_id, entity_type, entity_id, attachment_id);

create function validate_entity_attachment()
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

  raise exception 'attachment entity type is unsupported';
end;
$$;

create trigger entity_attachments_validate_owner
before insert or update on entity_attachments
for each row execute function validate_entity_attachment();

create table attachment_upload_requests (
  owner_id uuid not null references app_users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash char(64) not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  attachment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key),
  foreign key (owner_id, attachment_id)
    references attachments(owner_id, id)
    deferrable initially deferred
);

create index attachment_upload_requests_created_idx
  on attachment_upload_requests (created_at);

create table attachment_cleanup_jobs (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  attachment_id uuid,
  storage_provider text not null
    check (storage_provider in ('local', 's3')),
  storage_root text not null
    check (char_length(storage_root) between 1 and 512),
  object_key text not null
    check (
      char_length(object_key) between 1 and 512
      and object_key !~ '(^|/)\.\.(/|$)'
      and object_key !~ '^/'
    ),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or char_length(last_error_code) between 1 and 80
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attachment_cleanup_jobs_claim_idx
  on attachment_cleanup_jobs (scheduled_at, created_at, id)
  where status = 'pending';

create index attachment_cleanup_jobs_owner_created_idx
  on attachment_cleanup_jobs (owner_id, created_at desc);

update app_meta
set
  application_version = '0.4.0',
  schema_version = 4,
  updated_at = now()
where id = 1;
