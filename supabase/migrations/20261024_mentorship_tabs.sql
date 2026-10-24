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
