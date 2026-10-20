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
