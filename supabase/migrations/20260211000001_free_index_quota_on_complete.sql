-- Consume free indexing quota only when a video actually reaches complete indexing.

alter table public.videos
  add column if not exists free_index_quota_consumed boolean;

update public.videos
set free_index_quota_consumed = false
where free_index_quota_consumed is null;

alter table public.videos
  alter column free_index_quota_consumed set default false,
  alter column free_index_quota_consumed set not null;

-- Mark existing completed videos as already consumed so future updates do not double-charge.
update public.videos
set free_index_quota_consumed = true
where indexing_status = 'complete'
  and free_index_quota_consumed = false;

-- If historical usage was overcounted, cap it at completed-video count and quota.
with completed as (
  select external_channel_id, count(*)::integer as completed_count
  from public.videos
  where external_channel_id is not null
    and indexing_status = 'complete'
  group by external_channel_id
)
update public.external_channels ec
set free_indexes_used = least(
  coalesce(ec.free_index_quota, 0),
  coalesce(c.completed_count, 0)
)
from completed c
where ec.id = c.external_channel_id
  and ec.free_indexes_used > least(
    coalesce(ec.free_index_quota, 0),
    coalesce(c.completed_count, 0)
  );

update public.external_channels ec
set free_indexes_used = 0
where ec.free_indexes_used > 0
  and not exists (
    select 1
    from public.videos v
    where v.external_channel_id = ec.id
      and v.indexing_status = 'complete'
  );

create or replace function public.consume_free_index_quota_on_video_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.external_channel_id is null then
    return new;
  end if;

  if coalesce(new.free_index_quota_consumed, false) then
    return new;
  end if;

  if coalesce(new.indexing_status, '') <> 'complete' then
    return new;
  end if;

  update public.external_channels ec
  set free_indexes_used = least(
    coalesce(ec.free_index_quota, 0),
    coalesce(ec.free_indexes_used, 0) + 1
  )
  where ec.id = new.external_channel_id
    and coalesce(ec.free_indexes_used, 0) < coalesce(ec.free_index_quota, 0);

  new.free_index_quota_consumed = true;
  return new;
end;
$$;

drop trigger if exists consume_free_index_quota_on_video_complete on public.videos;
create trigger consume_free_index_quota_on_video_complete
  before insert or update of indexing_status, external_channel_id
  on public.videos
  for each row
  execute function public.consume_free_index_quota_on_video_complete();
