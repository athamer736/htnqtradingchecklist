-- NDA required to keep video access. Idempotent: safe to run more than once.
--
-- Every non-staff member must have a signed NDA on file (the Discord bot is the source of
-- truth). Unsigned members keep watching until an owner-set deadline, then playback locks.
--
--   mentorship_settings.nda_enforce_from  null = not enforced (the default). Set by the owner
--                                         in the Admin panel; from this moment unsigned
--                                         members are blocked.
--   nda_status_cache                      Only "when did the bot last confirm this member
--                                         signed". Boolean-only: no name, no document. Used so
--                                         a brief bot outage after the deadline does not lock
--                                         out members who already signed.
--
-- Service-role only: RLS on, all client grants revoked.

alter table public.mentorship_settings
  add column if not exists nda_enforce_from timestamptz,
  add column if not exists nda_enforce_set_by text;

create table if not exists public.nda_status_cache (
  discord_id  text        primary key check (discord_id ~ '^[0-9]{5,32}$'),
  verified_at timestamptz not null default now()
);

alter table public.nda_status_cache enable row level security;
revoke all on public.nda_status_cache from anon, authenticated;

-- Audit: who signed (a Discord ID, never the name or document) and who changed the deadline.
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
                    'nda_signed', 'nda_enforcement_set', 'nda_enforcement_cleared'));

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
                              'tab_managers', 'nda_settings')
       and target_id is null and target_discord_id is null and target_level is null)
    or (target_kind in ('video', 'recording', 'tab')
       and target_id is not null and target_discord_id is null
       and target_level is null and target_section is null)
  );
