create extension if not exists pgcrypto;

-- --- notebooks base table ---
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  pinned boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  last_edited_by text
);

-- --- margins base table ---
create table if not exists public.margins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete set null,
  verse_ids text[] not null default '{}'::text[],
  content text not null default '',
  tags text[] not null default '{}'::text[],
  rich_text_json text,
  inline_metadata_json text,
  title text,
  inline_verse_refs jsonb not null default '[]'::jsonb,
  first_verse text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  last_edited_by text
);

-- Ensure notebook columns exist on older schemas.
alter table if exists public.notebooks
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists pinned boolean,
  add column if not exists is_system boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists version bigint,
  add column if not exists last_edited_by text;

-- Legacy compatibility: some notebook schemas used "owner" instead of "user_id".
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notebooks'
      and column_name = 'owner'
  ) then
    update public.notebooks
    set user_id = case
      when owner::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then owner::text::uuid
      else user_id
    end
    where user_id is null;

    begin
      alter table public.notebooks alter column owner drop not null;
    exception when undefined_column then
      null;
    end;
  end if;
end;
$$;

update public.notebooks
set
  title = coalesce(nullif(title, ''), 'Notebook'),
  pinned = coalesce(pinned, false),
  is_system = coalesce(is_system, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  version = coalesce(version, 1)
where true;

alter table if exists public.notebooks
  alter column title set not null,
  alter column pinned set default false,
  alter column pinned set not null,
  alter column is_system set default false,
  alter column is_system set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column version set default 1,
  alter column version set not null;

do $$
begin
  if not exists (
    select 1
    from public.notebooks
    where user_id is null
  ) then
    alter table public.notebooks alter column user_id set not null;
  end if;
end;
$$;

-- If margins.notebook_id is text (legacy local 'default'), migrate to UUIDs safely.
do $$
declare
  notebook_id_type text;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'margins'
  ) then
    select c.data_type
      into notebook_id_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'margins'
      and c.column_name = 'notebook_id';

    if notebook_id_type is null then
      alter table public.margins add column notebook_id uuid;
    elsif notebook_id_type <> 'uuid' then
      alter table public.margins add column if not exists notebook_id_uuid uuid;

      update public.margins
      set notebook_id_uuid = case
        when notebook_id is null then null
        when notebook_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then notebook_id::uuid
        else null
      end
      where notebook_id_uuid is null;

      -- Create one default notebook per user when a row has a non-UUID notebook id.
      insert into public.notebooks (
        id,
        user_id,
        title,
        description,
        pinned,
        is_system,
        created_at,
        updated_at,
        version
      )
      select
        gen_random_uuid(),
        s.user_id,
        'Default Notebook',
        null,
        false,
        false,
        now(),
        now(),
        1
      from (
        select distinct user_id
        from public.margins
        where notebook_id_uuid is null
          and user_id is not null
      ) s
      where not exists (
        select 1
        from public.notebooks n
        where n.user_id = s.user_id
          and n.is_system = false
          and n.deleted_at is null
          and lower(n.title) = 'default notebook'
      );

      with notebook_choice as (
        select distinct on (n.user_id)
          n.user_id,
          case
            when n.id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then n.id::text::uuid
            else null
          end as id_uuid
        from public.notebooks n
        where n.is_system = false
          and n.deleted_at is null
        order by
          n.user_id,
          case when lower(n.title) = 'default notebook' then 0 else 1 end,
          n.created_at asc
      )
      update public.margins m
      set notebook_id_uuid = c.id_uuid
      from notebook_choice c
      where m.notebook_id_uuid is null
        and m.user_id = c.user_id
        and c.id_uuid is not null;

      alter table public.margins drop column notebook_id;
      alter table public.margins rename column notebook_id_uuid to notebook_id;
    end if;
  end if;
end;
$$;

-- Ensure margin columns exist on older schemas.
alter table if exists public.margins
  add column if not exists verse_ids text[],
  add column if not exists content text,
  add column if not exists tags text[],
  add column if not exists rich_text_json text,
  add column if not exists inline_metadata_json text,
  add column if not exists title text,
  add column if not exists inline_verse_refs jsonb,
  add column if not exists first_verse text,
  add column if not exists pinned boolean,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists version bigint,
  add column if not exists last_edited_by text;

update public.margins
set
  verse_ids = coalesce(verse_ids, '{}'::text[]),
  content = coalesce(content, ''),
  tags = coalesce(tags, '{}'::text[]),
  inline_verse_refs = coalesce(inline_verse_refs, '[]'::jsonb),
  pinned = coalesce(pinned, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  version = coalesce(version, 1)
where true;

alter table if exists public.margins
  alter column verse_ids set default '{}'::text[],
  alter column verse_ids set not null,
  alter column content set default '',
  alter column content set not null,
  alter column tags set default '{}'::text[],
  alter column tags set not null,
  alter column inline_verse_refs set default '[]'::jsonb,
  alter column inline_verse_refs set not null,
  alter column pinned set default false,
  alter column pinned set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column version set default 1,
  alter column version set not null;

-- Re-create notebook FK after potential notebook_id migration.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'margins'
      and column_name = 'notebook_id'
      and data_type = 'uuid'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notebooks'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    if not exists (
      select 1
      from information_schema.table_constraints tc
      where tc.table_schema = 'public'
        and tc.table_name = 'margins'
        and tc.constraint_type = 'FOREIGN KEY'
        and tc.constraint_name = 'margins_notebook_id_fkey'
    ) then
      alter table public.margins
        add constraint margins_notebook_id_fkey
          foreign key (notebook_id)
          references public.notebooks(id)
          on delete set null;
    end if;
  end if;
end;
$$;

create or replace function public.bump_notebooks_version()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at = coalesce(new.updated_at, now());
    new.version = coalesce(new.version, 1);
    return new;
  end if;

  if row(new.*) is distinct from row(old.*) then
    new.updated_at = now();
    new.version = coalesce(old.version, 0) + 1;
  else
    new.updated_at = old.updated_at;
    new.version = old.version;
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function public.bump_margins_version()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at = coalesce(new.updated_at, now());
    new.version = coalesce(new.version, 1);
    return new;
  end if;

  if row(new.*) is distinct from row(old.*) then
    new.updated_at = now();
    new.version = coalesce(old.version, 0) + 1;
  else
    new.updated_at = old.updated_at;
    new.version = old.version;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_notebooks_version on public.notebooks;
drop trigger if exists update_notebooks_updated_at on public.notebooks;
create trigger bump_notebooks_version
  before insert or update on public.notebooks
  for each row
  execute function public.bump_notebooks_version();

drop trigger if exists bump_margins_version on public.margins;
drop trigger if exists update_margins_updated_at on public.margins;
create trigger bump_margins_version
  before insert or update on public.margins
  for each row
  execute function public.bump_margins_version();

create index if not exists notebooks_user_updated_idx
  on public.notebooks (user_id, updated_at desc);
create index if not exists notebooks_user_deleted_idx
  on public.notebooks (user_id, deleted_at)
  where deleted_at is not null;
create index if not exists notebooks_user_version_idx
  on public.notebooks (user_id, version);

create index if not exists margins_user_updated_idx
  on public.margins (user_id, updated_at desc);
create index if not exists margins_user_deleted_idx
  on public.margins (user_id, deleted_at)
  where deleted_at is not null;
create index if not exists margins_user_version_idx
  on public.margins (user_id, version);
create index if not exists margins_notebook_idx
  on public.margins (notebook_id);
create index if not exists margins_first_verse_idx
  on public.margins (first_verse)
  where first_verse is not null;

alter table public.notebooks enable row level security;
alter table public.margins enable row level security;

drop policy if exists notebooks_select_own on public.notebooks;
create policy notebooks_select_own
  on public.notebooks
  for select
  using (auth.uid() = user_id);

drop policy if exists notebooks_insert_own on public.notebooks;
create policy notebooks_insert_own
  on public.notebooks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists notebooks_update_own on public.notebooks;
create policy notebooks_update_own
  on public.notebooks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists notebooks_delete_own on public.notebooks;
create policy notebooks_delete_own
  on public.notebooks
  for delete
  using (auth.uid() = user_id);

drop policy if exists margins_select_own on public.margins;
create policy margins_select_own
  on public.margins
  for select
  using (auth.uid() = user_id);

drop policy if exists margins_insert_own on public.margins;
create policy margins_insert_own
  on public.margins
  for insert
  with check (auth.uid() = user_id);

drop policy if exists margins_update_own on public.margins;
create policy margins_update_own
  on public.margins
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists margins_delete_own on public.margins;
create policy margins_delete_own
  on public.margins
  for delete
  using (auth.uid() = user_id);
