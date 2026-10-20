# Supabase setup (one-time)

The app can store your data in the cloud (and sync it across devices) using
[Supabase](https://supabase.com). This is optional per user, but the project
itself has to exist. Do these steps once.

## 1. Create the project
1. Go to https://supabase.com and sign up (free, no card).
2. Click **New project**. Pick a name and a region close to you. Save the
   database password somewhere (you won't need it for the app).
3. Wait ~2 minutes for it to finish provisioning.

## 2. Run the schema
1. In the project, open **SQL Editor** -> **New query**.
2. Paste the entire contents of [`schema.sql`](./schema.sql) and click **Run**.
3. You should see "Success". This creates the `sync_rows` table, its security
   rules, and the `screenshots` storage bucket. It is safe to re-run.

## 3. Turn off email confirmation (because you create accounts manually)
1. Go to **Authentication** -> **Providers** -> **Email**.
2. Ensure **Email** is enabled and turn **Confirm email** OFF, then save.

## 4. Create user logins
1. Go to **Authentication** -> **Users** -> **Add user** -> **Create new user**.
2. Enter an email + password for each person. Tick "Auto Confirm User".
3. Repeat for everyone who should have access.

## 5. Get the two keys the app needs
1. Go to **Project Settings** -> **API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Put them in a `.env` file at the repo root (copy `.env.example`):

   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

That's it. The anon key is safe to ship inside the app; all access is locked
down by the Row-Level Security rules from `schema.sql`. Never put the
`service_role` key in the app.

---

# Discord-gated login (mentorship enforcement)

In addition to email/password, users can sign in with **Discord**. Access to any
data is then hard-gated on being a **member of your mentorship Discord server**:
a server-side Edge Function checks membership with a bot token and records the
verdict in `authorized_members`, and the RLS policies require a fresh positive
verdict for every read/write. Email/password still works for admins (they just
need a seed row - see step 8).

The steps below are one-time. Do them in order.

## 6. Create the Discord application + bot
1. Go to https://discord.com/developers/applications -> **New Application**. Name
   it (e.g. "HTNQ Login") and create it.
2. Open **OAuth2** and copy the **Client ID** and **Client Secret**.
3. Under **OAuth2 -> Redirects**, add:
   `https://<project-ref>.supabase.co/auth/v1/callback`
   (replace `<project-ref>` with your Supabase project ref, the subdomain of
   your Project URL). Save.
4. Open **Bot** -> **Add Bot**. Copy the **Bot Token** (you'll need it in
   step 9). Turn on **Server Members Intent** (Privileged Gateway Intents):
   the staff Student Recordings picker searches guild members, which Discord
   only allows with that intent. Reading a single member's roles does not need it.
5. Invite the bot to your mentorship server. Open **OAuth2 -> URL Generator**,
   tick scope **`bot`** (no permissions needed), copy the generated URL, open it
   in a browser, and add the bot to the mentorship server.
6. Get the **Guild (server) ID**: in Discord, enable Developer Mode
   (User Settings -> Advanced), then right-click your server -> **Copy Server ID**.

## 7. Enable the Discord provider in Supabase
1. In Supabase, go to **Authentication -> Providers -> Discord**.
2. Toggle it on and paste the **Client ID** and **Client Secret** from step 6.
   Save.
3. Go to **Authentication -> URL Configuration -> Redirect URLs** and add BOTH:
   - the web app URL `https://app.htnq.org/` (also set it as the **Site URL**;
     see [`docs/web-hosting.md`](../docs/web-hosting.md)), and
   - the desktop loopback: `http://127.0.0.1:53123`
   Without the loopback URL, desktop Discord sign-in will fail.

## 8. Run/re-run the schema and seed admins
1. Re-run `schema.sql` (SQL Editor) - it now also creates `authorized_members`,
   the `is_authorized_member()` helper, and adds the membership check to every
   data policy. Safe to re-run.
2. **Important:** existing email/password admins have no Discord identity, so the
   new RLS clause would lock them out. Seed each admin once. Find their user id
   under **Authentication -> Users**, then run (per admin) in the SQL Editor:

   ```sql
   insert into public.authorized_members (user_id, discord_id, is_member, checked_at)
   values ('<admin-user-id>', null, true, 'infinity')
   on conflict (user_id) do update
     set is_member = true, checked_at = 'infinity';
   ```

   `'infinity'` is a valid `timestamptz` that never expires, so the freshness
   window always passes for that account. (The same snippet is in `schema.sql`.)

## 9. Set the Edge Function secrets and deploy it
The `verify-membership` function needs the bot token and guild id. Set them and
deploy using the Supabase CLI (from the repo root):

```
supabase secrets set DISCORD_BOT_TOKEN=<your-bot-token> DISCORD_GUILD_ID=<your-guild-id>
supabase functions deploy verify-membership
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions
automatically - do not set them yourself, and never ship the service role key in
the app.)

## How it fits together
- On any sign-in (Discord **or** email/password, and on every app launch/session
  restore), the app calls `verify-membership`.
- The function reads the user's Discord id from their linked identity, asks
  Discord `GET /guilds/{guildId}/members/{discordId}` with the bot token
  (200 = member, 404 = not), and upserts `authorized_members`.
- It also replaces `member_levels` from Discord Level roles (atomic delete+insert;
  failures clear levels so **video** access fails closed).
- If the user has no Discord identity (email/password admins), the function
  returns `no-discord-identity` and writes nothing - the seed row from step 8 is
  what keeps those accounts working for journal/sync.
- RLS requires a fresh (`< 7 days`) positive verdict for sync data. **Video
  playback does not use that 7-day window** — see below.

---

# Mentorship videos

Protected videos need additional server secrets and the tables from
`migrations/20261008_video_platform.sql` and
`migrations/20261016_roles_sections_recordings.sql` and
`migrations/20261018_admin_panel.sql` and
`migrations/20261019_member_legal_names.sql` and
`migrations/20261020_level_descriptions.sql` and
`migrations/20261020_section_descriptions.sql` and
`migrations/20261020_batch_sections.sql` (all also appended to `schema.sql`; all
are safe to re-run).

## 10. Extra secrets for videos

Set these in **Supabase → Edge Functions → Secrets** (or with
`supabase secrets set` in your own terminal):

| Secret | What it is |
| --- | --- |
| `MENTORSHIP_API_BASE_URL` | The bot's HTTPS **origin** on Railway, without a path (e.g. `https://<service>.up.railway.app`) |
| `MENTORSHIP_API_TOKEN` | The dedicated token for `POST /api/v1/member-access`; must equal the bot's `MEMBER_ACCESS_API_TOKEN` (not a Discord, Stripe, Checkout or Supabase key) |
| `BUNNY_STREAM_LIBRARY_ID` | Bunny Stream video library ID |
| `BUNNY_STREAM_TOKEN_KEY` | Library **Token Authentication** key (signs embed URLs) |
| `BUNNY_STREAM_API_KEY` | Library **API key** (creates/deletes videos, signs TUS uploads, reads encoding status) |
| `BUNNY_STREAM_CDN_HOSTNAME` | Optional: library CDN hostname (e.g. `vz-xxxx.b-cdn.net`) for thumbnails |
| `PLAYBACK_TTL_SECONDS` | Optional: upper bound on the signed embed lifetime, 60-1800, default 720. The bot's recheck interval (max 300 s) caps it further, so by default embeds last 390 s |

Discord role IDs for owner, admin, mentor, student and Levels 1-3 are built in
(see `functions/_shared/roles.ts`). Only set `DISCORD_ROLE_OWNER`,
`DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_MENTOR`, `DISCORD_ROLE_STUDENT` or
`DISCORD_ROLE_LEVEL_1` / `_2` / `_3` to point at a different (e.g. sandbox) server.

The three batch roles are built in the same way and overridden by `JULY_BATCH`
(1st Of July Batch), `SEPT_BATCH` (1st Of September Batch) and `BATCH_5` (Batch 5.0).
They are also set as Supabase secrets with those names. Each batch section opens for
students holding that role (plus the Student role) and for staff; the Railway bot
needs no change because it never sees these roles.

Never put any of these in `VITE_` client env. Details: [`docs/video-platform.md`](../docs/video-platform.md).
Bot API contract: [`docs/bot-handoff-member-access-api.md`](../docs/bot-handoff-member-access-api.md).

## 11. Deploy video functions

```
supabase functions deploy verify-membership
supabase functions deploy list-content
supabase functions deploy list-recordings
supabase functions deploy list-students
supabase functions deploy create-upload
supabase functions deploy manage-content
supabase functions deploy set-thumbnail
supabase functions deploy admin-members
supabase functions deploy admin-member-identity
supabase functions deploy admin-member-name
supabase functions deploy level-descriptions
supabase functions deploy issue-playback-token
supabase functions delete list-videos   # replaced by list-content
```

`set-thumbnail` lets staff replace a ready video's thumbnail (JPEG/PNG/WebP, up
to 2 MB; same permission as publishing: owner/admin anywhere, mentors in Level
videos). The thumbnail only shows on cards when `BUNNY_STREAM_CDN_HOSTNAME` is set.

`admin-members`, `admin-member-identity` and `admin-member-name` back the Admin
panel (owner/admin only). The member list needs the bot's **Server Members
Intent**; the bot half of the legal-name lookup also needs
`MENTORSHIP_API_BASE_URL` / `MENTORSHIP_API_TOKEN` (without them the lookup still
shows names admins recorded). Run `migrations/20261019_member_legal_names.sql`
first: it creates the service-role-only `member_legal_names` table that
`admin-member-name` writes.

`level-descriptions` serves the text at the top of each Level page and of Further
Studying, Lectures, Weekly Recaps and Recordings: any signed-in member reads the pages
their roles unlock (staff all of them), only owner/admin can write it, and changes are audited without copying the text. Run
`migrations/20261020_level_descriptions.sql` and `20261020_section_descriptions.sql`
first (service-role-only `level_descriptions` and `section_descriptions` tables; they
also widen the `content_audit` checks).

Until `MENTORSHIP_API_*` and Bunny secrets are set, playback and uploads fail
closed with a clear "not configured / unavailable" message. Local journals keep
working.

## 12. Who can do what

Every mentorship request checks the caller's **live** Discord roles. Email/password
accounts have no Discord identity and cannot watch or manage mentorship content
(the old `video_staff_access` email bypass is no longer used).

| Role | Watch | Upload | Publish / make private | Edit details | Delete |
| --- | --- | --- | --- | --- | --- |
| Owner, Admin | Everything | Every section and any student's recordings | Yes | Yes | Yes |
| Mentor | Everything, including every student's recordings | Level 1-3, Further Studying, batch sections and 1:1 recordings | Level 1-3, Further Studying, batch sections and recordings | No | No |
| Student | Level tabs up to their highest Level role (inclusive), Further Studying (Level 3 role only), their batch section(s), Lectures, Weekly Recaps, their own published recordings | No | No | No | No |

Staff playback still goes through the Railway mentorship check. The watermark is the
viewer's Discord ID (plus their legal name when one is on file), so staff do not need a recorded legal name to watch.
