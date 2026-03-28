-- Personal-first video access model: shared canonical indexing with per-user access grants.

create table if not exists public.video_user_access (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_type text not null default 'indexed_for_me',
  granted_at timestamptz not null default now(),
  granted_by_user_id uuid references auth.users(id) on delete set null,
  primary key (video_id, user_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_user_access_access_type_check'
  ) then
    alter table public.video_user_access
      add constraint video_user_access_access_type_check
      check (access_type in ('owner', 'indexed_for_me', 'legacy_assignment'));
  end if;
end $$;

create index if not exists video_user_access_user_granted_idx
  on public.video_user_access (user_id, granted_at desc);

create index if not exists videos_private_canonical_idx
  on public.videos (canonical_source_video_id, created_at asc)
  where visibility = 'private'
    and canonical_source_video_id is not null;

insert into public.video_user_access (video_id, user_id, access_type, granted_at, granted_by_user_id)
select
  v.id,
  v.owner_user_id,
  'owner',
  coalesce(v.indexed_at, v.created_at, now()),
  v.owner_user_id
from public.videos v
where v.owner_user_id is not null
on conflict (video_id, user_id) do update
set access_type = excluded.access_type;

alter table public.video_user_access enable row level security;

drop policy if exists video_user_access_select_own on public.video_user_access;
create policy video_user_access_select_own
  on public.video_user_access
  for select
  using (
    user_id = auth.uid()
    or (auth.jwt() ->> 'role') = 'service_role'
  );

drop policy if exists video_user_access_service_all on public.video_user_access;
create policy video_user_access_service_all
  on public.video_user_access
  for all
  using ((auth.jwt() ->> 'role') = 'service_role')
  with check ((auth.jwt() ->> 'role') = 'service_role');

drop policy if exists videos_read_public_owner_or_assigned on public.videos;
drop policy if exists videos_read_public_or_owner on public.videos;
create policy videos_read_public_owner_access_or_assigned
  on public.videos
  for select
  using (
    visibility = 'public'
    or owner_user_id = auth.uid()
    or exists (
      select 1
      from public.video_user_access vua
      where vua.video_id = videos.id
        and vua.user_id = auth.uid()
    )
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

drop policy if exists transcript_segments_read_public_owner_or_assigned on public.transcript_segments;
drop policy if exists transcript_segments_read_public_or_owner on public.transcript_segments;
create policy transcript_segments_read_public_owner_access_or_assigned
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
          or exists (
            select 1
            from public.video_user_access vua
            where vua.video_id = v.id
              and vua.user_id = auth.uid()
          )
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

drop policy if exists verse_occurrences_read_public_owner_or_assigned on public.verse_occurrences;
drop policy if exists verse_occurrences_read_public_or_owner on public.verse_occurrences;
create policy verse_occurrences_read_public_owner_access_or_assigned
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
          or exists (
            select 1
            from public.video_user_access vua
            where vua.video_id = v.id
              and vua.user_id = auth.uid()
          )
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

create or replace function public.content_personal_videos(
  p_query text default null,
  p_anchor_verse_id text default null,
  p_scope text default 'all',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  video_id uuid,
  source_video_id text,
  title text,
  description text,
  source_url text,
  thumbnail_url text,
  listing_state text,
  indexing_status text,
  transcript_status text,
  verse_status text,
  created_at timestamptz,
  match_start_ms integer,
  match_snippet text
)
language sql
stable
security invoker
set search_path = public
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      nullif(btrim(coalesce(p_anchor_verse_id, '')), '') as anchor,
      lower(coalesce(p_scope, 'all')) as scope_mode
  ),
  candidate as (
    select distinct v.*
    from public.videos v
    join public.video_user_access vua
      on vua.video_id = v.id
     and vua.user_id = auth.uid(),
      args a
    where v.visibility = 'private'
      and v.removed_at is null
      and (
        a.scope_mode <> 'page'
        or a.anchor is null
        or exists (
          select 1
          from public.verse_occurrences vo
          where vo.video_id = v.id
            and vo.anchor_verse_id = a.anchor
        )
      )
      and (
        a.q is null
        or coalesce(v.title, '') ilike '%' || a.q || '%'
        or coalesce(v.description, '') ilike '%' || a.q || '%'
        or exists (
          select 1
          from public.transcript_segments ts
          where ts.video_id = v.id
            and ts.text ilike '%' || a.q || '%'
        )
      )
  )
  select
    v.id as video_id,
    v.source_video_id,
    v.title,
    v.description,
    v.source_url,
    v.thumbnail_url,
    v.listing_state,
    v.indexing_status,
    v.transcript_status,
    v.verse_status,
    v.created_at,
    hit.start_ms as match_start_ms,
    hit.text as match_snippet
  from candidate v, args a
  left join lateral (
    select ts.start_ms, ts.text
    from public.transcript_segments ts
    where ts.video_id = v.id
      and (
        (a.scope_mode = 'page' and a.anchor is not null and exists (
          select 1 from public.verse_occurrences vo
          where vo.video_id = v.id
            and vo.anchor_verse_id = a.anchor
        ))
        or a.q is null
        or ts.text ilike '%' || a.q || '%'
      )
    order by ts.start_ms asc
    limit 1
  ) hit on true
  order by
    case when a.scope_mode = 'page' then coalesce(hit.start_ms, 2147483647) end asc nulls last,
    case when a.scope_mode <> 'page' then coalesce(v.indexed_at, v.created_at) end desc nulls last,
    coalesce(v.indexed_at, v.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 30), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

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
      or exists (
        select 1
        from public.video_user_access vua
        where vua.video_id = v.id
          and vua.user_id = auth.uid()
      )
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
    case
      when v.owner_user_id = auth.uid() then 0
      when exists (
        select 1
        from public.video_user_access vua
        where vua.video_id = v.id
          and vua.user_id = auth.uid()
      ) then 1
      else 2
    end,
    coalesce(v.indexed_at, v.published_at, v.created_at) desc,
    vo.start_ms asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.content_personal_videos(text, text, text, integer, integer) from public;
grant execute on function public.content_personal_videos(text, text, text, integer, integer) to authenticated;

revoke all on function public.search_verse_occurrences(text, integer, integer) from public;
grant execute on function public.search_verse_occurrences(text, integer, integer) to authenticated;
grant execute on function public.search_verse_occurrences(text, integer, integer) to service_role;
