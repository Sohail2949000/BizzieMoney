create table app_meta (
  id smallint primary key default 1 check (id = 1),
  application_version text not null,
  schema_version integer not null check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app_meta (id, application_version, schema_version)
values (1, '0.1.0', 1);
