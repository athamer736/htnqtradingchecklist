-- Further Studying: a Level 3 video section after Level 3 (idempotent).
-- Videos in it have no level (like Lectures); who can see it is decided by the
-- Edge Functions from live Discord roles (Level 3 role or staff), not the database.

alter table public.videos drop constraint if exists videos_section_check;
alter table public.videos add constraint videos_section_check
  check (section in ('level', 'lectures', 'weekly_recaps', 'further_studying'));
