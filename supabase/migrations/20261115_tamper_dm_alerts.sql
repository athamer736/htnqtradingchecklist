-- Discord DMs about watermark tamper flags. Idempotent: safe to run more than once.
-- Service-role only: RLS on, all client grants revoked.
--
--   security_alert_recipients  Owners and admins who turned on "DM me" in Admin -> Security.
--                              When a new tamper flag is recorded, the bot (DISCORD_BOT_TOKEN)
--                              DMs each of them, at most once per flagged member every 10
--                              minutes. Each person's live Discord role is checked before every
--                              DM; anyone who is no longer an owner or admin is taken off.

create table if not exists public.security_alert_recipients (
  discord_id  text        primary key check (discord_id ~ '^[0-9]{5,32}$'),
  added_at    timestamptz not null default now()
);

alter table public.security_alert_recipients enable row level security;
revoke all on public.security_alert_recipients from anon, authenticated;
