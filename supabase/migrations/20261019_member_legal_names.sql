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
