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
