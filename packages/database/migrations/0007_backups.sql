create table backup_configs (
  owner_id uuid primary key references app_users(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'daily'
    check (frequency in ('daily', 'weekly', 'monthly')),
  backup_time time without time zone not null default '02:00',
  day_of_week smallint
    check (day_of_week is null or day_of_week between 0 and 6),
  day_of_month smallint
    check (day_of_month is null or day_of_month between 1 and 28),
  destination text not null default 'local'
    check (destination in ('local', 's3')),
  local_subfolder text not null default 'automatic'
    check (
      char_length(local_subfolder) between 1 and 80
      and local_subfolder ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'
    ),
  s3_bucket text
    check (s3_bucket is null or char_length(s3_bucket) between 3 and 255),
  s3_region text
    check (s3_region is null or char_length(s3_region) between 1 and 100),
  s3_endpoint text
    check (s3_endpoint is null or char_length(s3_endpoint) between 8 and 2048),
  s3_prefix text
    check (
      s3_prefix is null
      or (
        char_length(s3_prefix) between 1 and 400
        and s3_prefix ~ '^[a-zA-Z0-9][a-zA-Z0-9/_-]*$'
        and s3_prefix !~ '(^|/)\.\.(/|$)'
      )
    ),
  s3_force_path_style boolean not null default false,
  s3_credentials_ciphertext text,
  retention_count smallint not null default 7
    check (retention_count between 1 and 100),
  include_attachments boolean not null default true,
  encryption_password_ciphertext text,
  next_run_at timestamptz,
  last_scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (frequency = 'daily' and day_of_week is null and day_of_month is null)
    or
    (frequency = 'weekly' and day_of_week is not null and day_of_month is null)
    or
    (frequency = 'monthly' and day_of_week is null and day_of_month is not null)
  ),
  check (
    destination = 'local'
    or (
      destination = 's3'
      and s3_bucket is not null
      and s3_region is not null
      and s3_prefix is not null
    )
  )
);

create index backup_configs_due_idx
  on backup_configs (next_run_at, owner_id)
  where enabled and next_run_at is not null;

create table backup_jobs (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  kind text not null
    check (kind in ('backup', 'preview', 'restore')),
  trigger_type text not null
    check (trigger_type in ('manual', 'scheduled', 'safety')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed')),
  idempotency_key text not null
    check (char_length(idempotency_key) between 1 and 200),
  source_artifact_id uuid,
  preview_id uuid,
  safety_artifact_id uuid,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  locked_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  progress_percent smallint not null default 0
    check (progress_percent between 0 and 100),
  progress_stage text not null default 'Waiting'
    check (char_length(progress_stage) between 1 and 120),
  error_code text
    check (error_code is null or char_length(error_code) between 1 and 80),
  error_message text
    check (error_message is null or char_length(error_message) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create index backup_jobs_claim_idx
  on backup_jobs (scheduled_at, created_at, id)
  where status = 'queued';

create index backup_jobs_owner_created_idx
  on backup_jobs (owner_id, created_at desc, id desc);

create index backup_jobs_source_artifact_idx
  on backup_jobs (source_artifact_id)
  where source_artifact_id is not null;

create table backup_artifacts (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  job_id uuid not null unique references backup_jobs(id) on delete restrict,
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
  file_name text not null
    check (char_length(file_name) between 1 and 255),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 char(64) not null
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'verified'
    check (status in ('verified', 'invalid', 'deleted')),
  encrypted boolean not null default false,
  includes_attachments boolean not null default false,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  application_version text not null
    check (char_length(application_version) between 1 and 40),
  schema_version integer not null check (schema_version > 0),
  manifest_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest_summary) = 'object'),
  backup_created_at timestamptz not null,
  verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_provider, storage_root, object_key)
);

create index backup_artifacts_owner_created_verified_idx
  on backup_artifacts (owner_id, backup_created_at desc, id desc)
  where status = 'verified';

create index backup_artifacts_job_fk_idx
  on backup_artifacts (job_id);

alter table backup_jobs
  add constraint backup_jobs_source_artifact_fkey
  foreign key (source_artifact_id)
  references backup_artifacts(id) on delete restrict;

alter table backup_jobs
  add constraint backup_jobs_safety_artifact_fkey
  foreign key (safety_artifact_id)
  references backup_artifacts(id) on delete restrict;

create table restore_previews (
  id uuid primary key,
  owner_id uuid not null references app_users(id) on delete cascade,
  artifact_id uuid not null references backup_artifacts(id) on delete restrict,
  job_id uuid not null unique references backup_jobs(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed')),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restore_previews_owner_expires_ready_idx
  on restore_previews (owner_id, expires_at, id)
  where status = 'ready' and used_at is null;

alter table backup_jobs
  add constraint backup_jobs_preview_fkey
  foreign key (preview_id)
  references restore_previews(id) on delete set null;

create table worker_heartbeats (
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
  schema_version = 7,
  updated_at = now()
where id = 1;
