-- Personal-first model: legacy videos.url should not be required.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'videos'
      and column_name = 'url'
      and is_nullable = 'NO'
  ) then
    alter table public.videos
      alter column url drop not null;
  end if;
end $$;
