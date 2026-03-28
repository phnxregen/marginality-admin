-- Personal-first model: external video linkage must be optional for private videos.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'videos'
      and column_name = 'external_video_id'
      and is_nullable = 'NO'
  ) then
    alter table public.videos
      alter column external_video_id drop not null;
  end if;
end $$;
