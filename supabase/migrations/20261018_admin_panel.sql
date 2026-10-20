-- Admin panel support. Idempotent: safe to run more than once.
--
-- Widens content_audit so it can also record:
--   * 'reordered'          - a manager moved a video up/down in its section
--   * 'member_name_viewed' - a manager looked up a member's legal name
-- Member lookups are identified by Discord id (a snowflake, not a uuid), so
-- target_id becomes nullable and target_discord_id is added. Only an id is ever
-- stored here; a legal name is never written to the database.

-- Replace the two inline CHECK constraints (their generated names can differ
-- between environments, so find them by what they constrain).
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.content_audit'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) like '%action%'
           or pg_get_constraintdef(oid) like '%target_kind%'
           or pg_get_constraintdef(oid) like '%target_id%')
  loop
    execute format('alter table public.content_audit drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.content_audit alter column target_id drop not null;
alter table public.content_audit add column if not exists target_discord_id text;

alter table public.content_audit
  add constraint content_audit_action_check
  check (action in ('upload_created', 'upload_resumed', 'visibility_changed',
                    'metadata_changed', 'deleted', 'status_refreshed',
                    'reordered', 'member_name_viewed'));

alter table public.content_audit
  add constraint content_audit_target_kind_check
  check (target_kind in ('video', 'recording', 'member'));

-- Content rows are identified by uuid, member rows by Discord id - never both.
alter table public.content_audit
  add constraint content_audit_target_check
  check (
    (target_kind = 'member' and target_discord_id is not null and target_id is null)
    or (target_kind <> 'member' and target_id is not null and target_discord_id is null)
  );

create index if not exists content_audit_member_idx
  on public.content_audit (target_discord_id, created_at desc)
  where target_discord_id is not null;

-- Still service-role only (RLS enabled, no client policies); see 20261016.
