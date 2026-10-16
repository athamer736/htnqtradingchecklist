-- Mentorship roles, content sections and 1:1 student recordings (idempotent).
-- Builds on 20261008_video_platform.sql without editing it. Safe to re-run.

-- === videos: sections, visibility, encoding, uploader =====================
alter table public.videos add column if not exists section text not null default 'level';
alter table public.videos add column if not exists visibility text not null default 'private';
alter table public.videos add column if not exists encoding_status text not null default 'ready';
alter table public.videos add column if not exists uploaded_by_discord_id text;
alter table public.videos add column if not exists deleted_at timestamptz;

-- Backfill visibility from the original boolean. Edge Functions keep
-- `published` in sync with `visibility` on every write, so re-running this is a
-- no-op rather than republishing hidden videos.
update public.videos set visibility = 'published'
  where published = true and visibility = 'private';

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
