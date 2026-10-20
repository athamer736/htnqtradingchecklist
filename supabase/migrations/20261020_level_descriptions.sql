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
