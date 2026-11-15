-- Watermark tamper reports. Idempotent: safe to run more than once.
--
-- When the video player or PDF viewer sees its personalised watermark removed, hidden, made
-- transparent or restyled, it stops and reports it here through the watermark-tamper function.
-- The member is the signed-in user and the item comes from their own grant for that session
-- (playback_audit.session_ref), never from the request. One row per session and reason.
--
-- Reports come from the viewer's own device, so they are evidence to look into, not proof.
-- Service-role only: RLS on, all client grants revoked. The owner chooses a retention period.

create table if not exists public.watermark_tamper_events (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  discord_id    text        not null check (discord_id ~ '^[0-9]{5,32}$'),
  session_ref   text        not null check (session_ref ~ '^[A-Za-z0-9]{8,64}$'),
  video_id      uuid,
  recording_id  uuid,
  document_id   uuid,
  reason        text        not null
                  check (reason in ('removed', 'moved', 'hidden', 'transparent',
                                    'restyled', 'shrunk', 'covered', 'text_changed')),
  platform      text        check (platform in ('desktop', 'web')),
  created_at    timestamptz not null default now(),
  unique (session_ref, reason)
);

create index if not exists watermark_tamper_events_member_idx
  on public.watermark_tamper_events (discord_id, created_at desc);

alter table public.watermark_tamper_events enable row level security;
revoke all on public.watermark_tamper_events from anon, authenticated;
