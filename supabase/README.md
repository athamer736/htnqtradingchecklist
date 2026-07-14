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
