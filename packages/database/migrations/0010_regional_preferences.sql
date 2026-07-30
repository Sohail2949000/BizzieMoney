alter table app_settings
  add column number_format text not null default '1,234.56';

alter table app_settings
  add constraint app_settings_date_format_supported
  check (
    date_format in (
      'MMM d, yyyy',
      'dd/MM/yyyy',
      'MM/dd/yyyy',
      'yyyy-MM-dd'
    )
  ),
  add constraint app_settings_number_format_supported
  check (
    number_format in (
      '1,234.56',
      '1.234,56',
      '1 234,56'
    )
  );

update app_meta
set
  application_version = '0.9.0',
  schema_version = 10,
  updated_at = now()
where id = 1;
