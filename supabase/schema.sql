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

-- === Mentorship membership gate ============================================
-- Only members of the mentorship Discord server may read/write data. The
-- `verify-membership` Edge Function (service role) is the sole writer of this
-- table; it checks Discord via the bot token and upserts the verdict here. RLS
-- below lets a user read only their own row, and every data policy additionally
-- requires a fresh `is_member = true` verdict (see is_authorized_member()).
create table if not exists public.authorized_members (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  discord_id text,
  is_member  boolean     not null default false,
  checked_at timestamptz not null default now()
);

alter table public.authorized_members enable row level security;

-- Users may read only their own membership row. There is deliberately NO
-- insert/update/delete policy: the Edge Function writes via the service role,
-- which bypasses RLS, so clients can never forge a verdict.
drop policy if exists "authorized_members_select_own" on public.authorized_members;
create policy "authorized_members_select_own"
  on public.authorized_members for select
  using (user_id = auth.uid());

-- True when the current user has a fresh, positive membership verdict. The
-- freshness window (7 days) makes access lapse automatically if verification
-- stops succeeding (e.g. they left the server and never re-verified).
create or replace function public.is_authorized_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.authorized_members m
    where m.user_id = auth.uid()
      and m.is_member
      and m.checked_at > now() - interval '7 days'
  );
$$;

-- ---------------------------------------------------------------------------
-- Seeding admin / email-password accounts
-- ---------------------------------------------------------------------------
-- Discord membership only covers users who signed in with Discord. Existing
-- email/password admins have no Discord identity, so the Edge Function returns
-- `no-discord-identity` and never writes them a positive row - which would lock
-- them out. Seed each such account manually with a far-future `checked_at` so
-- the freshness check always passes. Find the user id under Authentication ->
-- Users, then uncomment and run (repeat per admin):
--
--   insert into public.authorized_members (user_id, discord_id, is_member, checked_at)
--   values ('00000000-0000-0000-0000-000000000000', null, true, 'infinity')
--   on conflict (user_id) do update
--     set is_member = true, checked_at = 'infinity';
--
-- ('infinity' is a valid timestamptz that is always in the future, so the row
-- never expires. Use a concrete far-future date instead if you prefer.)
-- ---------------------------------------------------------------------------

-- === Row-Level Security ====================================================
alter table public.sync_rows enable row level security;

drop policy if exists "sync_rows_select_own" on public.sync_rows;
create policy "sync_rows_select_own"
  on public.sync_rows for select
  using (user_id = auth.uid() and public.is_authorized_member());

drop policy if exists "sync_rows_insert_own" on public.sync_rows;
create policy "sync_rows_insert_own"
  on public.sync_rows for insert
  with check (user_id = auth.uid() and public.is_authorized_member());

drop policy if exists "sync_rows_update_own" on public.sync_rows;
create policy "sync_rows_update_own"
  on public.sync_rows for update
  using (user_id = auth.uid() and public.is_authorized_member())
  with check (user_id = auth.uid() and public.is_authorized_member());

drop policy if exists "sync_rows_delete_own" on public.sync_rows;
create policy "sync_rows_delete_own"
  on public.sync_rows for delete
  using (user_id = auth.uid() and public.is_authorized_member());

-- === Storage bucket for screenshots ========================================
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Each user can only touch objects under a top-level folder named after their
-- own user id, e.g.  screenshots/<uid>/<imageId>.
drop policy if exists "screenshots_select_own" on storage.objects;
create policy "screenshots_select_own"
  on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text and public.is_authorized_member());

drop policy if exists "screenshots_insert_own" on storage.objects;
create policy "screenshots_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text and public.is_authorized_member());

drop policy if exists "screenshots_update_own" on storage.objects;
create policy "screenshots_update_own"
  on storage.objects for update
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text and public.is_authorized_member());

drop policy if exists "screenshots_delete_own" on storage.objects;
create policy "screenshots_delete_own"
  on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text and public.is_authorized_member());

-- Mentorship video platform tables (idempotent).
-- (Also shipped as supabase/migrations/20261008_video_platform.sql)

-- Safe to re-run. Apply via SQL Editor or `supabase db push` when linked.

-- === Video catalogue ========================================================
create table if not exists public.videos (
  id              uuid        primary key default gen_random_uuid(),
  bunny_video_id  text        not null unique,
  title           text        not null,
  description     text,
  level           int         not null check (level in (1, 2, 3)),
  duration_seconds int,
  thumbnail_url   text,
  published       boolean     not null default false,
  sort_ord        int         not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_published_ord_idx
  on public.videos (published, sort_ord);

alter table public.videos enable row level security;

-- Clients may list published rows only when they pass the existing sync
-- membership helper. Playback still goes through issue-playback-token which
-- enforces fresher Discord + Railway checks. No client writes.
drop policy if exists "videos_select_published_members" on public.videos;
create policy "videos_select_published_members"
  on public.videos for select
  using (published = true and public.is_authorized_member());

-- === Discord role → video levels (server-written only) =====================
create table if not exists public.member_levels (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  discord_id  text        not null,
  levels      int[]       not null default '{}',
  checked_at  timestamptz not null default now()
);

alter table public.member_levels enable row level security;

drop policy if exists "member_levels_select_own" on public.member_levels;
create policy "member_levels_select_own"
  on public.member_levels for select
  using (user_id = auth.uid());

-- === Explicit staff video path (email/password; no fabricated customers) ===
create table if not exists public.video_staff_access (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  label      text        not null default 'HTNQ Staff',
  levels     int[]       not null default '{1,2,3}',
  granted_at timestamptz not null default now()
);

alter table public.video_staff_access enable row level security;

drop policy if exists "video_staff_select_own" on public.video_staff_access;
create policy "video_staff_select_own"
  on public.video_staff_access for select
  using (user_id = auth.uid());

-- === Minimal playback audit (service role writes; no client policies) ======
create table if not exists public.playback_audit (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null,
  discord_id      text,
  video_id        uuid,
  bunny_video_id  text,
  session_ref     text        not null,
  outcome         text        not null,
  reason_code     text,
  level_required  int,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists playback_audit_user_created_idx
  on public.playback_audit (user_id, created_at desc);

alter table public.playback_audit enable row level security;
-- No policies: only service role (Edge Functions) can read/write.

-- Owner must choose retention (example: delete rows older than 90 days via
-- a scheduled job). Do not invent a legal retention period here.

-- Mentorship roles, sections and 1:1 recordings.
-- (Also shipped as supabase/migrations/20261016_roles_sections_recordings.sql)

-- === videos: sections, visibility, encoding, uploader =====================
alter table public.videos add column if not exists section text not null default 'level';
alter table public.videos add column if not exists visibility text not null default 'private';
alter table public.videos add column if not exists encoding_status text not null default 'ready';
alter table public.videos add column if not exists uploaded_by_discord_id text;
alter table public.videos add column if not exists deleted_at timestamptz;

-- Backfill visibility from the original boolean once (rows still at the default).
update public.videos set visibility = 'published'
  where published = true and visibility = 'private' and deleted_at is null
    and not exists (select 1 from public.content_audit_marker_backfill_done());

-- Lectures / Weekly Recaps have no level, so level becomes nullable and the
-- section decides whether it is required.
alter table public.videos alter column level drop not null;
alter table public.videos drop constraint if exists videos_level_check;
alter table public.videos drop constraint if exists videos_section_check;
alter table public.videos add constraint videos_section_check
  check (section in ('level', 'lectures', 'weekly_recaps'));
alter table public.videos drop constraint if exists videos_section_level_check;
alter table public.videos add constraint videos_section_level_check
  check ((section = 'level' and level in (1, 2, 3)) or (section <> 'level' and level is null));
alter table public.videos drop constraint if exists videos_visibility_check;
alter table public.videos add constraint videos_visibility_check
  check (visibility in ('published', 'private'));
alter table public.videos drop constraint if exists videos_encoding_status_check;
alter table public.videos add constraint videos_encoding_status_check
  check (encoding_status in ('uploading', 'processing', 'ready', 'failed'));

create index if not exists videos_section_level_idx
  on public.videos (section, level, sort_ord) where deleted_at is null;

-- All reads now go through Edge Functions that check live Discord roles, so the
-- client select policy (which relied on the 7-day sync window) is removed.
drop policy if exists "videos_select_published_members" on public.videos;

-- === 1:1 student recordings ================================================
create table if not exists public.student_recordings (
  id                      uuid        primary key default gen_random_uuid(),
  bunny_video_id          text        not null unique,
  student_discord_id      text        not null check (student_discord_id ~ '^[0-9]{5,32}$'),
  -- Discord display name snapshot for staff lists (not a legal name).
  student_label           text,
  title                   text        not null,
  description             text,
  recorded_at             date,
  duration_seconds        int,
  visibility              text        not null default 'private'
                            check (visibility in ('published', 'private')),
  encoding_status         text        not null default 'uploading'
                            check (encoding_status in ('uploading', 'processing', 'ready', 'failed')),
  uploaded_by_discord_id  text        not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create index if not exists student_recordings_student_idx
  on public.student_recordings (student_discord_id, created_at desc) where deleted_at is null;

alter table public.student_recordings enable row level security;
-- No client policies: Edge Functions (service role) enforce every rule.

-- === Playback audit: recordings ============================================
alter table public.playback_audit add column if not exists recording_id uuid;

-- === Content management audit ==============================================
create table if not exists public.content_audit (
  id                uuid        primary key default gen_random_uuid(),
  actor_user_id     uuid        not null,
  actor_discord_id  text        not null,
  action            text        not null
                      check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                                        'metadata_changed', 'deleted', 'status_refreshed')),
  target_kind       text        not null check (target_kind in ('video', 'recording')),
  target_id         uuid        not null,
  detail            jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists content_audit_target_idx
  on public.content_audit (target_kind, target_id, created_at desc);

alter table public.content_audit enable row level security;
-- No client policies: service role only. The owner chooses a retention period.

-- video_staff_access (from 20261008) is no longer used: staff are identified by
-- live Discord roles and every playback requires a linked Discord identity.

-- ===========================================================================
-- === Admin panel (migrations/20261018_admin_panel.sql) ====================
-- ===========================================================================
-- Admin panel support. Idempotent: safe to run more than once.
--
-- Widens content_audit so it can also record:
--   * 'reordered'          - a manager moved a video up/down in its section
--   * 'member_name_viewed' - a manager looked up a member's legal name
-- Member lookups are identified by Discord id (a snowflake, not a uuid), so
-- target_id becomes nullable and target_discord_id is added. Only an id is ever
-- stored here; a legal name is never written to the database.

-- Replace the two inline CHECK constraints (their generated names can differ
-- between environments, so find them by what they constrain).
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.content_audit'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) like '%action%'
           or pg_get_constraintdef(oid) like '%target_kind%'
           or pg_get_constraintdef(oid) like '%target_id%')
  loop
    execute format('alter table public.content_audit drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.content_audit alter column target_id drop not null;
alter table public.content_audit add column if not exists target_discord_id text;

alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed'));

alter table public.content_audit
  add constraint content_audit_target_kind_check
  check (target_kind in ('video', 'recording', 'member'));

-- Content rows are identified by uuid, member rows by Discord id - never both.
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member' and target_discord_id is not null and target_id is null)
    or (target_kind <> 'member' and target_id is not null and target_discord_id is null)
  );

create index if not exists content_audit_member_idx
  on public.content_audit (target_discord_id, created_at desc)
  where target_discord_id is not null;

-- Still service-role only (RLS enabled, no client policies); see 20261016.


-- ===========================================================================
-- === Admin-entered legal names (migrations/20261019_member_legal_names.sql) =
-- ===========================================================================

-- Admin-entered legal names. Idempotent: safe to run more than once.
--
-- An owner/admin can record a member's legal name from the Admin panel. This is
-- an ADMIN REFERENCE ONLY: it is shown in the Admin panel next to whatever the
-- mentorship bot reports, and it is never used for access decisions or sent to
-- the video player (the playback watermark is the member's Discord ID).
--
-- One row per Discord id (a snowflake, not a uuid). Service-role only: RLS is
-- enabled with no client policies and all client grants are revoked, so only the
-- Edge Functions (which first verify an owner/admin role) can read or write it.

create table if not exists public.member_legal_names (
  discord_id        text        primary key
                      check (discord_id ~ '^[0-9]{15,25}$'),
  legal_name        text        not null
                      check (char_length(legal_name) between 2 and 200),
  set_by_user_id    uuid,
  set_by_discord_id text        not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.member_legal_names enable row level security;
revoke all on public.member_legal_names from anon, authenticated;
-- No client policies: service role only. Delete a row to erase a name (the
-- Admin panel's "Remove name" does exactly that).

-- The audit trail records WHO set or cleared a name, never the name itself.
alter table public.content_audit drop constraint if exists content_audit_action_check;
alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed',
                    'member_name_set', 'member_name_cleared'));

-- === Level descriptions (migrations/20261020_level_descriptions.sql) =======
-- Level descriptions. Idempotent: safe to run more than once.
--
-- An owner/admin writes a short description for each mentorship Level (1-3)
-- that students read at the top of that Level's page. One row per Level; no row
-- means no description. Text is stored as typed (line breaks kept) and rendered
-- by the app with a tiny safe formatter, never as HTML.
--
-- Service-role only: RLS is enabled with no client policies and all client
-- grants are revoked, so only the `level-descriptions` Edge Function (which
-- re-checks live Discord roles) can read or write it. Clearing a description
-- deletes the row.

create table if not exists public.level_descriptions (
  level             smallint    primary key check (level in (1, 2, 3)),
  description       text        not null
                      check (char_length(description) between 1 and 4000),
  set_by_user_id    uuid,
  set_by_discord_id text        not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.level_descriptions enable row level security;
revoke all on public.level_descriptions from anon, authenticated;

-- The audit trail records WHO changed a Level's description and when. The text
-- itself is not copied into the audit row.
alter table public.content_audit add column if not exists target_level smallint;

alter table public.content_audit drop constraint if exists content_audit_action_check;
alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed',
                    'member_name_set', 'member_name_cleared',
                    'level_description_set', 'level_description_cleared'));

alter table public.content_audit drop constraint if exists content_audit_target_kind_check;
alter table public.content_audit
  add constraint content_audit_target_kind_check
  check (target_kind in ('video', 'recording', 'member', 'level'));

-- Content rows are identified by uuid, members by Discord id, Levels by number.
alter table public.content_audit drop constraint if exists content_audit_target_check;
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member'
       and target_discord_id is not null and target_id is null and target_level is null)
    or (target_kind = 'level'
       and target_level in (1, 2, 3) and target_id is null and target_discord_id is null)
    or (target_kind in ('video', 'recording')
       and target_id is not null and target_discord_id is null and target_level is null)
  );

-- === Further Studying section (migrations/20261020_further_studying.sql) =======
-- Further Studying: a Level 3 video section after Level 3 (idempotent).
-- Videos in it have no level (like Lectures); who can see it is decided by the
-- Edge Functions from live Discord roles (Level 3 role or staff), not the database.

alter table public.videos drop constraint if exists videos_section_check;
alter table public.videos add constraint videos_section_check
  check (section in ('level', 'lectures', 'weekly_recaps', 'further_studying'));

-- === Section descriptions (migrations/20261020_section_descriptions.sql) ========
-- Section descriptions. Idempotent: safe to run more than once.
--
-- Same idea as level_descriptions, for the other Mentorship pages: Further
-- Studying, Lectures, Weekly Recaps & Outlooks and Recordings. An owner/admin
-- writes the text members read at the top of that page. One row per page; no
-- row means no description.
--
-- Service-role only: RLS is enabled with no client policies and all client
-- grants are revoked, so only the `level-descriptions` Edge Function (which
-- re-checks live Discord roles) can read or write it.

create table if not exists public.section_descriptions (
  section           text        primary key
                      check (section in ('further_studying', 'lectures', 'weekly_recaps', 'recordings')),
  description       text        not null
                      check (char_length(description) between 1 and 4000),
  set_by_user_id    uuid,
  set_by_discord_id text        not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.section_descriptions enable row level security;
revoke all on public.section_descriptions from anon, authenticated;

-- Audit: who changed which page's description (the text is never copied).
alter table public.content_audit add column if not exists target_section text;

alter table public.content_audit drop constraint if exists content_audit_action_check;
alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed',
                    'member_name_set', 'member_name_cleared',
                    'level_description_set', 'level_description_cleared',
                    'section_description_set', 'section_description_cleared'));

alter table public.content_audit drop constraint if exists content_audit_target_kind_check;
alter table public.content_audit
  add constraint content_audit_target_kind_check
  check (target_kind in ('video', 'recording', 'member', 'level', 'section'));

-- Exactly one identifier per target kind.
alter table public.content_audit drop constraint if exists content_audit_target_check;
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member'
       and target_discord_id is not null and target_id is null
       and target_level is null and target_section is null)
    or (target_kind = 'level'
       and target_level in (1, 2, 3) and target_id is null
       and target_discord_id is null and target_section is null)
    or (target_kind = 'section'
       and target_section in ('further_studying', 'lectures', 'weekly_recaps', 'recordings')
       and target_id is null and target_discord_id is null and target_level is null)
    or (target_kind in ('video', 'recording')
       and target_id is not null and target_discord_id is null
       and target_level is null and target_section is null)
  );

-- === Batch sections (migrations/20261020_batch_sections.sql) ====================
-- Batch sections: 1st Of July Batch, 1st Of September Batch, Batch 5.0
-- (idempotent). Videos in them have no level, like Lectures. Who can see each
-- section is decided by the Edge Functions from live Discord roles (the matching
-- batch role plus the Student role, or staff), not by the database.

alter table public.videos drop constraint if exists videos_section_check;
alter table public.videos add constraint videos_section_check
  check (section in ('level', 'lectures', 'weekly_recaps', 'further_studying',
                     'july_batch', 'sept_batch', 'batch_5'));

-- The batch pages can carry a description like the other section pages.
alter table public.section_descriptions drop constraint if exists section_descriptions_section_check;
alter table public.section_descriptions
  add constraint section_descriptions_section_check
  check (section in ('further_studying', 'lectures', 'weekly_recaps',
                     'july_batch', 'sept_batch', 'batch_5', 'recordings'));

alter table public.content_audit drop constraint if exists content_audit_target_check;
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member'
       and target_discord_id is not null and target_id is null
       and target_level is null and target_section is null)
    or (target_kind = 'level'
       and target_level in (1, 2, 3) and target_id is null
       and target_discord_id is null and target_section is null)
    or (target_kind = 'section'
       and target_section in ('further_studying', 'lectures', 'weekly_recaps',
                              'july_batch', 'sept_batch', 'batch_5', 'recordings')
       and target_id is null and target_discord_id is null and target_level is null)
    or (target_kind in ('video', 'recording')
       and target_id is not null and target_discord_id is null
       and target_level is null and target_section is null)
  );


-- === Editable Mentorship tabs (migrations/20261024_mentorship_tabs.sql) =========
-- Editable Mentorship tabs (version 2.0.3). Idempotent: safe to run more than once.
--
-- Before: the Mentorship pages (Level 1-3, Further Studying, Lectures, Weekly
-- Recaps, three batches) were fixed in code. Now each one is a row in
-- mentorship_tabs that an owner/admin (or a role chosen as "tab manager") can add,
-- rename, reorder, delete and set role lists on.
--
-- Three role lists per tab, all "any of":
--   view_role_ids   - may open the tab. Empty = every Student. The Student role is
--                     ALWAYS required to view (checked by the Edge Functions) except
--                     for staff, so these lists only narrow it.
--   upload_role_ids - may upload, publish and hide videos in the tab.
--   manage_role_ids - may edit details, reorder and delete videos, and edit the
--                     tab's description.
-- Owners and admins can always do everything. Who may create/rename/reorder/delete
-- tabs and change these lists is mentorship_settings.tab_manager_role_ids (the
-- owner can always; only the owner edits that list).
--
-- Service-role only: RLS is on and all client grants are revoked, so only Edge
-- Functions (which re-check live Discord roles) can read or write.
--
-- The old videos.section / videos.level columns are KEPT so installed 2.0.2 apps
-- keep working during the rollout; the Edge Functions translate between them and
-- tab_id.

-- === Tabs ==================================================================
create table if not exists public.mentorship_tabs (
  id                    uuid        primary key default gen_random_uuid(),
  slug                  text        not null unique
                          check (slug ~ '^[a-z0-9_]{1,40}$'),
  title                 text        not null
                          check (char_length(title) between 1 and 60),
  description           text
                          check (description is null or char_length(description) between 1 and 4000),
  sort_ord              int         not null default 0,
  view_role_ids         text[]      not null default '{}',
  upload_role_ids       text[]      not null default '{}',
  manage_role_ids       text[]      not null default '{}',
  created_by_discord_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint mentorship_tabs_view_roles_check
    check (cardinality(view_role_ids) <= 25
           and array_to_string(view_role_ids, ',') ~ '^([0-9]{5,32}(,[0-9]{5,32})*)?$'),
  constraint mentorship_tabs_upload_roles_check
    check (cardinality(upload_role_ids) <= 25
           and array_to_string(upload_role_ids, ',') ~ '^([0-9]{5,32}(,[0-9]{5,32})*)?$'),
  constraint mentorship_tabs_manage_roles_check
    check (cardinality(manage_role_ids) <= 25
           and array_to_string(manage_role_ids, ',') ~ '^([0-9]{5,32}(,[0-9]{5,32})*)?$')
);

create index if not exists mentorship_tabs_order_idx
  on public.mentorship_tabs (sort_ord, created_at);

alter table public.mentorship_tabs enable row level security;
revoke all on public.mentorship_tabs from anon, authenticated;

-- === Settings (a single row) ===============================================
create table if not exists public.mentorship_settings (
  id                    smallint    primary key default 1 check (id = 1),
  tab_manager_role_ids  text[]      not null default '{}'
                          check (cardinality(tab_manager_role_ids) <= 25
                                 and array_to_string(tab_manager_role_ids, ',')
                                     ~ '^([0-9]{5,32}(,[0-9]{5,32})*)?$'),
  updated_by_discord_id text,
  updated_at            timestamptz not null default now()
);

alter table public.mentorship_settings enable row level security;
revoke all on public.mentorship_settings from anon, authenticated;

-- Admins manage tabs by default (the owner always can and is not listed).
insert into public.mentorship_settings (id, tab_manager_role_ids)
values (1, array['1499493868419420262'])
on conflict (id) do nothing;

-- === Seed the tabs that existed before ====================================
-- Role ids are the Discord defaults baked into supabase/functions/_shared/roles.ts.
--   mentor 1554810663799488553
--   level1 1504525385059270847  level2 1504525684322730176  level3 1504525483814158376
--   july   1519790781731176619  sept   1543216213080154183  batch5 1561824503447687279
-- The view lists reproduce today's behaviour (Level 3 holders see Levels 1-3, etc.).
insert into public.mentorship_tabs
  (slug, title, sort_ord, view_role_ids, upload_role_ids, manage_role_ids)
values
  ('level_1', 'Level 1', 10,
    array['1554810663799488553','1504525385059270847','1504525684322730176','1504525483814158376'],
    array['1554810663799488553'], '{}'),
  ('level_2', 'Level 2', 20,
    array['1554810663799488553','1504525684322730176','1504525483814158376'],
    array['1554810663799488553'], '{}'),
  ('level_3', 'Level 3', 30,
    array['1554810663799488553','1504525483814158376'],
    array['1554810663799488553'], '{}'),
  ('further_studying', 'Further Studying', 40,
    array['1554810663799488553','1504525483814158376'],
    array['1554810663799488553'], '{}'),
  -- Lectures and Weekly Recaps were open to every Student: an empty view list means
  -- exactly that. Mentors (staff) may always view, see tabAccess.ts.
  ('lectures', 'Lectures', 50, '{}', '{}', '{}'),
  ('weekly_recaps', 'Weekly Recaps & Outlooks', 60, '{}', '{}', '{}'),
  ('july_batch', '1st Of July Batch', 70,
    array['1554810663799488553','1519790781731176619'],
    array['1554810663799488553'], '{}'),
  ('sept_batch', '1st Of September Batch', 80,
    array['1554810663799488553','1543216213080154183'],
    array['1554810663799488553'], '{}'),
  ('batch_5', 'Batch 5.0', 90,
    array['1554810663799488553','1561824503447687279'],
    array['1554810663799488553'], '{}')
on conflict (slug) do nothing;

-- === Move descriptions onto the tabs ======================================
update public.mentorship_tabs t
   set description = d.description
  from public.level_descriptions d
 where t.slug = 'level_' || d.level
   and t.description is null;

update public.mentorship_tabs t
   set description = d.description
  from public.section_descriptions d
 where t.slug = d.section
   and d.section <> 'recordings'
   and t.description is null;
-- level_descriptions / section_descriptions stay in place (the Recordings row is
-- still read from section_descriptions) but tabs are now the source of truth.

-- === videos.tab_id =========================================================
alter table public.videos
  add column if not exists tab_id uuid references public.mentorship_tabs (id) on delete restrict;

update public.videos v
   set tab_id = t.id
  from public.mentorship_tabs t
 where v.tab_id is null
   and t.slug = case when v.section = 'level' then 'level_' || v.level else v.section end;

create index if not exists videos_tab_idx
  on public.videos (tab_id, sort_ord) where deleted_at is null;

-- A 2.0.2 function/app inserting by section/level still lands in the right tab.
create or replace function public.videos_default_tab()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tab_id is null then
    select id into new.tab_id
      from public.mentorship_tabs
     where slug = case when new.section = 'level' then 'level_' || new.level else new.section end;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_default_tab on public.videos;
create trigger videos_default_tab
  before insert on public.videos
  for each row execute function public.videos_default_tab();

-- Videos in an admin-created tab have no legacy section: 'custom' with no level.
alter table public.videos drop constraint if exists videos_section_check;
alter table public.videos add constraint videos_section_check
  check (section in ('level', 'lectures', 'weekly_recaps', 'further_studying',
                     'july_batch', 'sept_batch', 'batch_5', 'custom'));

-- === Audit =================================================================
alter table public.content_audit drop constraint if exists content_audit_action_check;
alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed',
                    'member_name_set', 'member_name_cleared',
                    'level_description_set', 'level_description_cleared',
                    'section_description_set', 'section_description_cleared',
                    'tab_created', 'tab_updated', 'tab_deleted',
                    'tab_roles_changed', 'tab_managers_changed'));

alter table public.content_audit drop constraint if exists content_audit_target_kind_check;
alter table public.content_audit
  add constraint content_audit_target_kind_check
  check (target_kind in ('video', 'recording', 'member', 'level', 'section', 'tab'));

-- A tab is identified by its uuid like a video. "tab_managers_changed" has no
-- single tab, so it is recorded against the settings row via target_section.
alter table public.content_audit drop constraint if exists content_audit_target_check;
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member'
       and target_discord_id is not null and target_id is null
       and target_level is null and target_section is null)
    or (target_kind = 'level'
       and target_level in (1, 2, 3) and target_id is null
       and target_discord_id is null and target_section is null)
    or (target_kind = 'section'
       and target_section in ('further_studying', 'lectures', 'weekly_recaps',
                              'july_batch', 'sept_batch', 'batch_5', 'recordings',
                              'tab_managers')
       and target_id is null and target_discord_id is null and target_level is null)
    or (target_kind in ('video', 'recording', 'tab')
       and target_id is not null and target_discord_id is null
       and target_level is null and target_section is null)
  );
