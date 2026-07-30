update app_meta
set
  application_version = '1.0.0',
  schema_version = 16,
  updated_at = now()
where id = 1;
