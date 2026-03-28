-- Channel assignment access, channel lifecycle status, and admin unlock metadata.

alter table public.external_channels
  add column if not exists channel_lifecycle_status text,
  add column if not exists officialized_at timestamptz,
  add column if not exists platform_video_count integer,
  add column if not exists free_index_quota integer,
  add column if not exists free_indexes_used integer;

update public.external_channels
set channel_lifecycle_status = 'invited'
where channel_lifecycle_status is null;

update public.external_channels
set platform_video_count = coalesce(platform_video_count, 0),
    free_index_quota = coalesce(free_index_quota, 3),
    free_indexes_used = coalesce(free_indexes_used, 0)
where platform_video_count is null
  or free_index_quota is null
  or free_indexes_used is null;

alter table public.external_channels
  alter column channel_lifecycle_status set default 'invited',
  alter column channel_lifecycle_status set not null,
  alter column platform_video_count set default 0,
  alter column platform_video_count set not null,
  alter column free_index_quota set default 3,
  alter column free_index_quota set not null,
  alter column free_indexes_used set default 0,
  alter column free_indexes_used set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_channels_lifecycle_status_check'
  ) then
    alter table public.external_channels
      add constraint external_channels_lifecycle_status_check
      check (channel_lifecycle_status in ('invited', 'official'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_channels_platform_video_count_check'
  ) then
    alter table public.external_channels
      add constraint external_channels_platform_video_count_check
      check (platform_video_count >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_channels_free_index_quota_check'
  ) then
    alter table public.external_channels
      add constraint external_channels_free_index_quota_check
      check (free_index_quota >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_channels_free_indexes_used_check'
  ) then
    alter table public.external_channels
      add constraint external_channels_free_indexes_used_check
      check (free_indexes_used >= 0 and free_indexes_used <= free_index_quota);
  end if;
end $$;

create table if not exists public.channel_assignments (
  id uuid primary key default gen_random_uuid(),
  external_channel_id uuid not null references public.external_channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text,
  role text not null default 'viewer',
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_channel_id, user_id)
);

alter table public.channel_assignments
  add column if not exists external_channel_id uuid references public.external_channels (id) on delete cascade,
  add column if not exists user_id uuid references auth.users (id) on delete cascade,
  add column if not exists user_email text,
  add column if not exists role text default 'viewer',
  add column if not exists assigned_by uuid references auth.users (id),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.channel_assignments
set role = coalesce(nullif(lower(role), ''), 'viewer')
where role is null
  or lower(role) not in ('owner', 'editor', 'viewer');

alter table public.channel_assignments
  alter column role set default 'viewer',
  alter column role set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_assignments_role_check'
  ) then
    alter table public.channel_assignments
      add constraint channel_assignments_role_check
      check (role in ('owner', 'editor', 'viewer'));
  end if;
end $$;

create unique index if not exists channel_assignments_channel_user_unique_idx
  on public.channel_assignments (external_channel_id, user_id);

create index if not exists channel_assignments_user_id_idx
  on public.channel_assignments (user_id, created_at desc);

create index if not exists channel_assignments_external_channel_id_idx
  on public.channel_assignments (external_channel_id, created_at desc);

create index if not exists channel_assignments_user_email_idx
  on public.channel_assignments (lower(user_email))
  where user_email is not null;

create or replace function public.update_channel_assignments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_channel_assignments_updated_at on public.channel_assignments;
create trigger update_channel_assignments_updated_at
  before update on public.channel_assignments
  for each row
  execute function public.update_channel_assignments_updated_at();

alter table public.videos
  add column if not exists admin_unlocked boolean,
  add column if not exists indexing_unlock_reason text,
  add column if not exists indexing_unlocked_at timestamptz,
  add column if not exists unlocked_by_user_id uuid references auth.users (id);

update public.videos
set admin_unlocked = coalesce(admin_unlocked, false)
where admin_unlocked is null;

alter table public.videos
  alter column admin_unlocked set default false,
  alter column admin_unlocked set not null;

create index if not exists videos_external_channel_indexing_idx
  on public.videos (external_channel_id, indexing_status, created_at desc)
  where external_channel_id is not null;

create index if not exists videos_admin_unlocked_idx
  on public.videos (admin_unlocked, indexing_unlocked_at desc);

drop function if exists public.officialize_channel(uuid, text);

create or replace function public.officialize_channel(
  p_external_channel_id uuid,
  p_reason text default 'manual'
)
returns public.external_channels
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_channel public.external_channels;
begin
  if p_external_channel_id is null then
    raise exception 'p_external_channel_id is required';
  end if;

  update public.external_channels
  set channel_lifecycle_status = 'official',
      officialized_at = coalesce(officialized_at, now())
  where id = p_external_channel_id
  returning * into updated_channel;

  if not found then
    raise exception 'external channel % not found', p_external_channel_id;
  end if;

  return updated_channel;
end;
$$;

comment on function public.officialize_channel(uuid, text)
  is 'Marks an external channel official and records when officialization occurred.';

revoke all on function public.officialize_channel(uuid, text) from public;
grant execute on function public.officialize_channel(uuid, text) to service_role;

create or replace function public.auto_officialize_channel_from_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.external_channel_id is null then
    return new;
  end if;

  if coalesce(new.visibility, '') = 'public'
      or coalesce(new.listing_state, '') = 'published' then
    update public.external_channels
    set channel_lifecycle_status = 'official',
        officialized_at = coalesce(officialized_at, now())
    where id = new.external_channel_id
      and channel_lifecycle_status <> 'official';
  end if;

  return new;
end;
$$;

drop trigger if exists videos_auto_officialize_channel on public.videos;
create trigger videos_auto_officialize_channel
  after insert or update of visibility, listing_state, external_channel_id
  on public.videos
  for each row
  execute function public.auto_officialize_channel_from_video();

alter table public.channel_assignments enable row level security;

drop policy if exists channel_assignments_select_own on public.channel_assignments;
create policy channel_assignments_select_own
  on public.channel_assignments
  for select
  using (
    user_id = auth.uid()
    or (auth.jwt() ->> 'role') = 'service_role'
  );

drop policy if exists channel_assignments_service_all on public.channel_assignments;
create policy channel_assignments_service_all
  on public.channel_assignments
  for all
  using ((auth.jwt() ->> 'role') = 'service_role')
  with check ((auth.jwt() ->> 'role') = 'service_role');

drop policy if exists videos_read_public_or_owner on public.videos;
drop policy if exists videos_read_public_owner_or_assigned on public.videos;
create policy videos_read_public_owner_or_assigned
  on public.videos
  for select
  using (
    visibility = 'public'
    or owner_user_id = auth.uid()
    or (
      external_channel_id is not null
      and exists (
        select 1
        from public.channel_assignments ca
        where ca.external_channel_id = videos.external_channel_id
          and ca.user_id = auth.uid()
      )
    )
    or (auth.jwt() ->> 'role') = 'service_role'
  );

drop policy if exists transcript_segments_read_public_or_owner on public.transcript_segments;
drop policy if exists transcript_segments_read_public_owner_or_assigned on public.transcript_segments;
create policy transcript_segments_read_public_owner_or_assigned
  on public.transcript_segments
  for select
  using (
    exists (
      select 1
      from public.videos v
      where v.id = transcript_segments.video_id
        and (
          v.visibility = 'public'
          or v.owner_user_id = auth.uid()
          or (
            v.external_channel_id is not null
            and exists (
              select 1
              from public.channel_assignments ca
              where ca.external_channel_id = v.external_channel_id
                and ca.user_id = auth.uid()
            )
          )
        )
    )
  );

drop policy if exists verse_occurrences_read_public_or_owner on public.verse_occurrences;
drop policy if exists verse_occurrences_read_public_owner_or_assigned on public.verse_occurrences;
create policy verse_occurrences_read_public_owner_or_assigned
  on public.verse_occurrences
  for select
  using (
    exists (
      select 1
      from public.videos v
      where v.id = verse_occurrences.video_id
        and (
          v.visibility = 'public'
          or v.owner_user_id = auth.uid()
          or (
            v.external_channel_id is not null
            and exists (
              select 1
              from public.channel_assignments ca
              where ca.external_channel_id = v.external_channel_id
                and ca.user_id = auth.uid()
            )
          )
        )
    )
  );

create or replace function public.search_verse_occurrences(
  p_anchor_verse_id text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  occurrence_id uuid,
  video_id uuid,
  source_video_id text,
  title text,
  source_url text,
  thumbnail_url text,
  visibility text,
  owner_user_id uuid,
  anchor_verse_id text,
  raw_reference text,
  start_ms integer,
  end_ms integer,
  kind text,
  has_spoken boolean,
  confidence numeric,
  raw_snippet text,
  detection_source text,
  detection_version text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    vo.id as occurrence_id,
    vo.video_id,
    vo.source_video_id,
    v.title,
    v.source_url,
    v.thumbnail_url,
    v.visibility,
    v.owner_user_id,
    vo.anchor_verse_id,
    vo.raw_reference,
    vo.start_ms,
    vo.end_ms,
    vo.kind,
    vo.has_spoken,
    vo.confidence,
    vo.raw_snippet,
    vo.detection_source,
    vo.detection_version,
    vo.created_at
  from public.verse_occurrences vo
  join public.videos v on v.id = vo.video_id
  where vo.anchor_verse_id = p_anchor_verse_id
    and (
      v.visibility = 'public'
      or v.owner_user_id = auth.uid()
      or (
        v.external_channel_id is not null
        and exists (
          select 1
          from public.channel_assignments ca
          where ca.external_channel_id = v.external_channel_id
            and ca.user_id = auth.uid()
        )
      )
    )
  order by
    case when v.owner_user_id = auth.uid() then 0 else 1 end,
    coalesce(v.published_at, v.created_at) desc,
    vo.start_ms asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_verse_occurrences(text, integer, integer) from public;
grant execute on function public.search_verse_occurrences(text, integer, integer) to authenticated;
grant execute on function public.search_verse_occurrences(text, integer, integer) to service_role;
