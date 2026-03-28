-- Personal-first indexing uses platform='personal' for non-YouTube private content.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'videos_platform_check'
  ) then
    alter table public.videos
      drop constraint videos_platform_check;
  end if;
end $$;

alter table public.videos
  add constraint videos_platform_check
  check (platform in ('youtube', 'internal', 'personal'));
