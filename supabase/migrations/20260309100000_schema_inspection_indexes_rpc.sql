-- Diagnostic-only index inspection RPC for auditing remote drift.

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
