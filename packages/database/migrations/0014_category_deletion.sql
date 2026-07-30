update app_meta
set
  application_version = '0.13.0',
  schema_version = 14,
  updated_at = now()
where id = 1;
