create table attachment_storage_configs (
  owner_id uuid primary key references app_users(id) on delete cascade,
  active_provider text not null default 'local'
    check (active_provider in ('local', 's3')),
  s3_bucket text
    check (s3_bucket is null or char_length(s3_bucket) between 3 and 255),
  s3_region text
    check (s3_region is null or char_length(s3_region) between 1 and 100),
  s3_endpoint text
    check (s3_endpoint is null or char_length(s3_endpoint) between 8 and 2048),
  s3_prefix text
    check (s3_prefix is null or char_length(s3_prefix) between 1 and 400),
  s3_force_path_style boolean not null default false,
  s3_credentials_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachment_storage_configs_s3_complete check (
    (
      s3_bucket is null
      and s3_region is null
      and s3_endpoint is null
      and s3_prefix is null
      and s3_credentials_ciphertext is null
    )
    or (
      s3_bucket is not null
      and s3_region is not null
      and s3_prefix is not null
    )
  ),
  constraint attachment_storage_configs_active_s3_ready check (
    active_provider <> 's3'
    or (
      s3_bucket is not null
      and s3_region is not null
      and s3_prefix is not null
    )
  )
);

create table attachment_storage_s3_profiles (
  owner_id uuid not null references app_users(id) on delete cascade,
  storage_root text not null
    check (char_length(storage_root) between 3 and 512),
  bucket text not null
    check (char_length(bucket) between 3 and 255),
  region text not null
    check (char_length(region) between 1 and 100),
  endpoint text
    check (endpoint is null or char_length(endpoint) between 8 and 2048),
  prefix text not null
    check (char_length(prefix) between 1 and 400),
  force_path_style boolean not null default false,
  credentials_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, storage_root)
);

update app_meta
set
  application_version = '0.12.0',
  schema_version = 13,
  updated_at = now()
where id = 1;
