alter table public.videos
  add column if not exists transcript_timing_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_transcript_timing_mode_check'
  ) then
    alter table public.videos
      add constraint videos_transcript_timing_mode_check
      check (transcript_timing_mode in ('exact', 'estimated'));
  end if;
end $$;

with latest_transcript_runs as (
  select distinct on (ir.video_id)
    ir.video_id,
    case
      when lower(coalesce(ir.meta ->> 'timing_mode', '')) in ('exact', 'estimated')
        then lower(ir.meta ->> 'timing_mode')
      when coalesce(ir.meta ->> 'estimated_timestamps', 'false') = 'true'
        then 'estimated'
      else 'exact'
    end as timing_mode
  from public.indexing_runs ir
  where ir.phase = 'transcript_acquisition'
    and ir.status = 'complete'
  order by
    ir.video_id,
    case
      when ir.meta ? 'timing_mode' or ir.meta ? 'estimated_timestamps' then 0
      else 1
    end,
    ir.created_at desc,
    ir.id desc
)
update public.videos v
set transcript_timing_mode = ltr.timing_mode
from latest_transcript_runs ltr
where v.id = ltr.video_id
  and (
    v.transcript_timing_mode is distinct from ltr.timing_mode
    or v.transcript_timing_mode is null
  );
