create table if not exists public.word_highlights (
  user_id uuid not null references auth.users(id) on delete cascade,
  bible_version text not null default 'ESV',
  verse_id text not null,
  highlights jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table if exists public.word_highlights
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists bible_version text,
  add column if not exists verse_id text,
  add column if not exists highlights jsonb,
  add column if not exists updated_at timestamptz;

update public.word_highlights
set
  bible_version = coalesce(nullif(upper(trim(bible_version)), ''), 'ESV'),
  highlights = coalesce(highlights, '{}'::jsonb),
  updated_at = coalesce(updated_at, now())
where true;

alter table if exists public.word_highlights
  alter column bible_version set default 'ESV',
  alter column bible_version set not null,
  alter column highlights set default '{}'::jsonb,
  alter column highlights set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from public.word_highlights
    where user_id is null
      or verse_id is null
  ) then
    alter table public.word_highlights
      alter column user_id set not null,
      alter column verse_id set not null;
  end if;
end;
$$;

do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'word_highlights'
      and c.contype in ('u', 'p')
      and (
        select array_agg(a.attname::text order by col.ord)
        from unnest(c.conkey) with ordinality as col(attnum, ord)
        join pg_attribute a
          on a.attrelid = t.oid
         and a.attnum = col.attnum
      ) = array['user_id', 'verse_id']::text[]
  loop
    execute format(
      'alter table public.word_highlights drop constraint %I',
      rec.conname
    );
  end loop;
end;
$$;

do $$
declare
  rec record;
begin
  for rec in
    select i.indexrelid::regclass::text as index_name
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'word_highlights'
      and i.indisunique
      and (
        select array_agg(a.attname::text order by col.ord)
        from unnest(i.indkey) with ordinality as col(attnum, ord)
        join pg_attribute a
          on a.attrelid = t.oid
         and a.attnum = col.attnum
      ) = array['user_id', 'verse_id']::text[]
  loop
    execute format('drop index if exists %s', rec.index_name);
  end loop;
end;
$$;

create unique index if not exists word_highlights_user_version_verse_uidx
  on public.word_highlights (user_id, bible_version, verse_id);

create index if not exists word_highlights_user_version_updated_idx
  on public.word_highlights (user_id, bible_version, updated_at desc, verse_id);

create or replace function public.bump_word_highlights_updated_at()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at = coalesce(new.updated_at, now());
    return new;
  end if;

  if row(new.*) is distinct from row(old.*) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_word_highlights_updated_at on public.word_highlights;
create trigger bump_word_highlights_updated_at
  before insert or update on public.word_highlights
  for each row
  execute function public.bump_word_highlights_updated_at();

alter table public.word_highlights enable row level security;

drop policy if exists word_highlights_select_own on public.word_highlights;
create policy word_highlights_select_own
  on public.word_highlights
  for select
  using (auth.uid() = user_id);

drop policy if exists word_highlights_insert_own on public.word_highlights;
create policy word_highlights_insert_own
  on public.word_highlights
  for insert
  with check (auth.uid() = user_id);

drop policy if exists word_highlights_update_own on public.word_highlights;
create policy word_highlights_update_own
  on public.word_highlights
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists word_highlights_delete_own on public.word_highlights;
create policy word_highlights_delete_own
  on public.word_highlights
  for delete
  using (auth.uid() = user_id);
