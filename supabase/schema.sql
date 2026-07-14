-- HTNQ Trading Checklist - Supabase schema
-- ---------------------------------------------------------------------------
-- Run this ONCE in your Supabase project: Dashboard -> SQL Editor -> New query
-- -> paste this whole file -> Run. It is safe to re-run (idempotent).
--
-- What it creates:
--   * sync_rows  - one row per synced record (trades, data-collection, etc.)
--                  stored as JSONB, isolated per user via Row-Level Security.
--   * a trigger  - stamps server_updated_at on every write (the sync cursor).
--   * screenshots - a Storage bucket for entry screenshots, isolated per user.
--
-- Design note: every record is kept as an opaque JSONB `data` blob keyed by
-- (user_id, kind, id). The server never needs to read individual fields; the
-- app owns the shape. This means we never have to migrate the database when the
-- app's data model changes.
-- ---------------------------------------------------------------------------

-- === Sync table ============================================================
create table if not exists public.sync_rows (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text        not null,           -- 'trade' | 'section' | 'column' | 'tag' | 'entry' | 'app_state'
  id                text        not null,           -- client-generated record id
  data              jsonb       not null,           -- the full record
  updated_at        timestamptz not null,           -- client logical modify time (last-write-wins)
  deleted_at        timestamptz,                    -- soft-delete tombstone
  server_updated_at timestamptz not null default now(), -- server clock, used as the pull cursor
  primary key (user_id, kind, id)
);

-- Fast "changes since cursor" lookups for a user.
create index if not exists sync_rows_cursor_idx
  on public.sync_rows (user_id, server_updated_at);

-- === Server-side cursor stamp ==============================================
create or replace function public.stamp_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_rows_stamp on public.sync_rows;
create trigger sync_rows_stamp
  before insert or update on public.sync_rows
  for each row execute function public.stamp_server_updated_at();

-- === Row-Level Security ====================================================
alter table public.sync_rows enable row level security;

drop policy if exists "sync_rows_select_own" on public.sync_rows;
create policy "sync_rows_select_own"
  on public.sync_rows for select
  using (user_id = auth.uid());

drop policy if exists "sync_rows_insert_own" on public.sync_rows;
create policy "sync_rows_insert_own"
  on public.sync_rows for insert
  with check (user_id = auth.uid());

drop policy if exists "sync_rows_update_own" on public.sync_rows;
create policy "sync_rows_update_own"
  on public.sync_rows for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sync_rows_delete_own" on public.sync_rows;
create policy "sync_rows_delete_own"
  on public.sync_rows for delete
  using (user_id = auth.uid());

-- === Storage bucket for screenshots ========================================
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Each user can only touch objects under a top-level folder named after their
-- own user id, e.g.  screenshots/<uid>/<imageId>.
drop policy if exists "screenshots_select_own" on storage.objects;
create policy "screenshots_select_own"
  on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "screenshots_insert_own" on storage.objects;
create policy "screenshots_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "screenshots_update_own" on storage.objects;
create policy "screenshots_update_own"
  on storage.objects for update
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "screenshots_delete_own" on storage.objects;
create policy "screenshots_delete_own"
  on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
