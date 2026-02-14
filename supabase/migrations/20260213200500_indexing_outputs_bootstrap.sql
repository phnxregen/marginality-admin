-- Bootstrap indexing_outputs table required by indexing preflight/storage paths.

create table if not exists public.indexing_outputs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  source_video_id text not null,
  indexing_run_id uuid not null references public.indexing_runs(id) on delete cascade,
  output_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.indexing_outputs
  add column if not exists source_video_id text,
  add column if not exists indexing_run_id uuid references public.indexing_runs(id) on delete cascade,
  add column if not exists output_type text,
  add column if not exists payload jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'indexing_outputs_type_check'
  ) then
    alter table public.indexing_outputs
      add constraint indexing_outputs_type_check
      check (output_type in ('transcript_occurrences', 'ocr_occurrences'));
  end if;
end $$;

update public.indexing_outputs
set created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
where created_at is null
  or updated_at is null;

alter table public.indexing_outputs
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column source_video_id set not null,
  alter column indexing_run_id set not null,
  alter column output_type set not null,
  alter column payload set not null;

create unique index if not exists indexing_outputs_video_type_unique_idx
  on public.indexing_outputs (video_id, output_type);

create index if not exists indexing_outputs_video_idx
  on public.indexing_outputs (video_id, created_at desc);

create index if not exists indexing_outputs_source_video_idx
  on public.indexing_outputs (source_video_id, created_at desc);

create index if not exists indexing_outputs_run_idx
  on public.indexing_outputs (indexing_run_id);

create or replace function public.update_indexing_outputs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_indexing_outputs_updated_at on public.indexing_outputs;
create trigger update_indexing_outputs_updated_at
  before update on public.indexing_outputs
  for each row
  execute function public.update_indexing_outputs_updated_at();
