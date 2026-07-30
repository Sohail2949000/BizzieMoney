select pg_catalog.set_config(
  'search_path',
  pg_catalog.quote_ident(current_schema()) || ',pg_catalog',
  true
);

create or replace function validate_entity_attachment()
returns trigger
language plpgsql
set search_path from current
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
  application_version = '0.13.0',
  schema_version = 15,
  updated_at = now()
where id = 1;
