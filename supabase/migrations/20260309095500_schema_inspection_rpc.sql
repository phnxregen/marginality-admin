-- Diagnostic-only schema inspection RPCs for auditing remote drift.

create or replace function public.inspect_table_columns(
  p_table_name text,
  p_table_schema text default 'public'
)
returns table (
  ordinal_position integer,
  column_name text,
  is_nullable boolean,
  data_type text,
  column_default text
)
language sql
stable
security definer
set search_path = public, information_schema
as $$
  select
    c.ordinal_position::integer,
    c.column_name::text,
    (c.is_nullable = 'YES') as is_nullable,
    c.data_type::text,
    c.column_default::text
  from information_schema.columns c
  where c.table_schema = p_table_schema
    and c.table_name = p_table_name
  order by c.ordinal_position asc;
$$;

create or replace function public.inspect_table_constraints(
  p_table_name text,
  p_table_schema text default 'public'
)
returns table (
  constraint_name text,
  constraint_type text,
  definition text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    con.conname::text as constraint_name,
    case con.contype
      when 'p' then 'primary_key'
      when 'f' then 'foreign_key'
      when 'u' then 'unique'
      when 'c' then 'check'
      when 'n' then 'not_null'
      else con.contype::text
    end as constraint_type,
    pg_get_constraintdef(con.oid)::text as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = p_table_schema
    and rel.relname = p_table_name

  union all

  select
    format('%s_%s_not_null', cls.relname, att.attname)::text as constraint_name,
    'not_null'::text as constraint_type,
    format('COLUMN %I IS NOT NULL', att.attname)::text as definition
  from pg_attribute att
  join pg_class cls on cls.oid = att.attrelid
  join pg_namespace nsp on nsp.oid = cls.relnamespace
  where nsp.nspname = p_table_schema
    and cls.relname = p_table_name
    and att.attnum > 0
    and not att.attisdropped
    and att.attnotnull;
$$;

revoke all on function public.inspect_table_columns(text, text) from public;
grant execute on function public.inspect_table_columns(text, text) to service_role;

revoke all on function public.inspect_table_constraints(text, text) from public;
grant execute on function public.inspect_table_constraints(text, text) to service_role;

create or replace function public.inspect_table_indexes(
  p_table_name text,
  p_table_schema text default 'public'
)
returns table (
  index_name text,
  index_definition text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    i.indexname::text,
    i.indexdef::text
  from pg_indexes i
  where i.schemaname = p_table_schema
    and i.tablename = p_table_name
  order by i.indexname asc;
$$;

revoke all on function public.inspect_table_indexes(text, text) from public;
grant execute on function public.inspect_table_indexes(text, text) to service_role;
