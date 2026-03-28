-- Personal-first model: partner-channel linkage must remain optional.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'videos'
      and column_name = 'partner_channel_id'
      and is_nullable = 'NO'
  ) then
    alter table public.videos
      alter column partner_channel_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'playlists'
      and column_name = 'owner_partner_channel_id'
      and is_nullable = 'NO'
  ) then
    alter table public.playlists
      alter column owner_partner_channel_id drop not null;
  end if;
end $$;
