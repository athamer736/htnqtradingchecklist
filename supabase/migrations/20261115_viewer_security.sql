-- Viewer security: flags, paused viewing and one video at a time. Idempotent: safe to run more
-- than once. Service-role only: RLS on, all client grants revoked.
--
--   viewer_alerts     Flags staff may want to look at, one row per thing that happened
--                     (dedup_key). Kinds:
--                       tamper         the player saw its watermark removed, hidden or restyled
--                                      and stopped (reported by watermark-tamper; the item comes
--                                      from the reporter's own grant for that session)
--                       second_stream  a new play pushed out a video still playing elsewhere
--                       many_opens     unusually many different items opened within an hour
--                       leak_traced    staff traced a leaked file or reference to this viewing
--                     Player reports come from the viewer's own device: evidence, not proof.
--   viewing_holds     Members whose viewing (videos, recordings, documents) is paused until an
--                     owner or admin reauthorises them. Placed by hand or automatically.
--   active_streams    The one video slot per account: the player that holds it and when it last
--                     checked in (every 20 s).
--   mentorship_settings.auto_hold_after_flags
--                     Pause viewing automatically after this many tamper flags (null = off).
--
-- The owner chooses a retention period for viewer_alerts.

create table if not exists public.viewer_alerts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  discord_id    text        not null check (discord_id ~ '^[0-9]{5,32}$'),
  kind          text        not null
                  check (kind in ('tamper', 'second_stream', 'many_opens', 'leak_traced')),
  dedup_key     text        not null unique check (char_length(dedup_key) <= 200),
  session_ref   text        check (session_ref ~ '^[A-Za-z0-9]{8,64}$'),
  reason        text
                  check (reason in ('removed', 'moved', 'hidden', 'transparent',
                                    'restyled', 'shrunk', 'covered', 'text_changed')),
  platform      text        check (platform in ('desktop', 'web')),
  video_id      uuid,
  recording_id  uuid,
  document_id   uuid,
  detail        jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  check ((kind = 'tamper') = (reason is not null))
);

create index if not exists viewer_alerts_member_idx
  on public.viewer_alerts (discord_id, created_at desc);
create index if not exists viewer_alerts_created_idx
  on public.viewer_alerts (created_at desc);

alter table public.viewer_alerts enable row level security;
revoke all on public.viewer_alerts from anon, authenticated;

create table if not exists public.viewing_holds (
  discord_id          text        primary key check (discord_id ~ '^[0-9]{5,32}$'),
  user_id             uuid,
  reason              text        not null check (reason in ('manual', 'auto_tamper')),
  note                text        check (char_length(note) <= 300),
  held_by_discord_id  text        check (held_by_discord_id ~ '^[0-9]{5,32}$'),
  created_at          timestamptz not null default now()
);

alter table public.viewing_holds enable row level security;
revoke all on public.viewing_holds from anon, authenticated;

create table if not exists public.active_streams (
  user_id       uuid        primary key,
  discord_id    text        not null check (discord_id ~ '^[0-9]{5,32}$'),
  stream_id     text        not null check (stream_id ~ '^[0-9a-fA-F]{16,64}$'),
  session_ref   text,
  video_id      uuid,
  recording_id  uuid,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.active_streams enable row level security;
revoke all on public.active_streams from anon, authenticated;

alter table public.mentorship_settings
  add column if not exists auto_hold_after_flags smallint
    check (auto_hold_after_flags between 1 and 20),
  add column if not exists auto_hold_set_by text;

-- Audit: pausing and reauthorising members, the auto-pause setting and leak traces (ids only).
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
                    'tab_roles_changed', 'tab_managers_changed',
                    'nda_signed', 'nda_enforcement_set', 'nda_enforcement_cleared',
                    'viewing_held', 'viewing_released', 'viewer_security_set', 'leak_traced'));

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
                              'tab_managers', 'nda_settings', 'viewer_security')
       and target_id is null and target_discord_id is null and target_level is null)
    or (target_kind in ('video', 'recording', 'tab', 'document')
       and target_id is not null and target_discord_id is null
       and target_level is null and target_section is null)
  );
