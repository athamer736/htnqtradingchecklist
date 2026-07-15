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
   step 9). No privileged gateway intents are required - reading a single
   member uses the REST API only.
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
   - your web app's site URL (e.g. `https://yourname.github.io/htnq/` - the page
     the web build is served from), and
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
- If the user has no Discord identity (email/password admins), the function
  returns `no-discord-identity` and writes nothing - the seed row from step 8 is
  what keeps those accounts working.
- RLS requires a fresh (`< 7 days`) positive verdict, so access lapses
  automatically if someone leaves the server and stops re-verifying.
