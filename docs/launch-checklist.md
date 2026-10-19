# Launch checklist (mentorship videos)

## Implemented (this branch)

- [x] Live Discord role capabilities: owner, admin, mentor, student, inclusive Levels 1-3
- [x] Sections: Level 1-3, Lectures, Weekly Recaps & Outlooks; private/published; encoding status
- [x] 1:1 student recordings (staff upload and browse; students see only their own)
- [x] Edge Functions: `list-content`, `list-recordings`, `list-students`, `create-upload`,
      `manage-content`, `issue-playback-token`, `verify-membership` (`list-videos` removed)
- [x] Direct resumable TUS uploads to Bunny (multi-GB), content audit trail
- [x] Watermark + Railway mentorship check on every video, including staff and recordings
- [x] Email/password staff video bypass removed
- [x] Sidebar Mentorship group, section views, Student Recordings / My Recordings, upload dialog
- [x] Desktop CSP allows the Bunny player, TUS endpoint and thumbnails
- [x] macOS desktop build removed; web app workflow for `app.htnq.org`
- [x] Bot member-access client matched to the implemented contract: strict schema_version 1
      validation, ≤300 s allowed-decision window, in-player revalidation with bounded retries,
      `staff_record` names only with a live staff role, Retry-After pass-through

## Tested

- [x] `npm test`: roles, permission matrix, request validation, authorisation pipeline,
      playback pipeline (Railway denied / outage / mismatch / missing name, private, level, not ready),
      Bunny embed + TUS signing, Bunny API helpers, Railway contract (all mocked)
- [x] Member-access integration against the **test-only** bot mock over localhost
      (`tests/memberAccessIntegration.test.ts`), revalidation/expiry/revocation logic,
      client-bundle secret and log guards
- [x] `npm run typecheck`, `npm run build:web`, `deno check` on every Edge Function
- [ ] Real Supabase Edge Function deploy
- [ ] Real bot endpoint (bot PR #10 is a draft, not deployed)
- [ ] Real Bunny library: upload, encode, signed embed playback
- [ ] Two-account sandbox: watermark identity, denial, recording isolation
- [ ] Mobile capture blocking / DRM (not claimed)

## Configure in the cloud (owner)

### Supabase SQL

Apply in order (all idempotent; all are also appended to `schema.sql`):

1. `supabase/migrations/20261008_video_platform.sql`
2. `supabase/migrations/20261016_roles_sections_recordings.sql`
3. `supabase/migrations/20261018_admin_panel.sql` (Admin panel: wider `content_audit`)

Videos are added through the in-app upload dialog; no manual `videos` inserts are needed.

### Supabase Edge Function secrets

Enter these in **Supabase → Edge Functions → Secrets** (or `supabase secrets set` in your
own terminal). Do not paste secrets into chat.

- `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`
- `MENTORSHIP_API_BASE_URL`, `MENTORSHIP_API_TOKEN`
- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_TOKEN_KEY`, `BUNNY_STREAM_API_KEY`
- Optional: `BUNNY_STREAM_CDN_HOSTNAME` (thumbnails), `PLAYBACK_TTL_SECONDS`
- Optional: `DISCORD_ROLE_OWNER` / `_ADMIN` / `_MENTOR` / `_STUDENT` / `_LEVEL_1..3`
  only to override the built-in role IDs (for example for a sandbox server)

Remove `DISCORD_ROLE_LEVEL_*` secrets that only duplicate the built-in IDs, and
`VIDEO_ROLE_MAX_AGE_SECONDS` (no longer used).

### Discord

- Developer Portal → Bot → turn on **Server Members Intent** (needed for the student search).

### Deploy functions (requires explicit deployment authorisation)

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
supabase functions deploy issue-playback-token
supabase functions delete list-videos
```

### Bunny

1. Enable **Embed view token authentication** on the library.
2. `BUNNY_STREAM_TOKEN_KEY` = the library **Token Authentication key**.
3. `BUNNY_STREAM_API_KEY` = the library **API key** (Stream → library → API).
4. Leave **Allowed domains** empty: the player sends no referrer and the desktop app has
   no web origin, so a domain allow-list would block playback. Token authentication
   protects each embed.
5. Turn on **MediaCage Basic DRM** (free) before the first upload. It blocks easy
   downloads and only allows embed playback, which is the only route the platform uses.
   Keep MP4 fallback off. It does not stop screen recording; the watermark is the
   deterrent for that.
6. **MediaCage Enterprise DRM** (from $99/month) is not recommended for now: stock
   Electron has no Widevine CDM, so the Windows app could not play protected videos
   without moving to a Widevine-enabled Electron build.

### Railway bot

1. Done in the bot's draft PR #10 (`member-access-api`); review, then deploy a
   **sandbox** bot service first (requires deployment authorisation).
2. Generate separate sandbox and production credentials (e.g. `openssl rand -hex 32`).
   On the bot service set `MEMBER_ACCESS_API_TOKEN`; on Supabase set
   `MENTORSHIP_API_TOKEN` to the same value. Never reuse other secrets.
3. `MENTORSHIP_API_BASE_URL` = the bot service's HTTPS origin, no path.
4. Record legal names in the bot's staff table for every owner/admin/mentor who
   will watch or preview videos.

### Sandbox test (before production)

Use a sandbox Supabase project (or the production one with sandbox secrets only
after explicit approval), a sandbox bot deployment and its own credential.

1. Secrets: `MENTORSHIP_API_BASE_URL`, `MENTORSHIP_API_TOKEN` (sandbox values),
   plus the Discord and Bunny secrets above. Do **not** set
   `MENTORSHIP_API_ALLOW_HTTP_LOCALHOST`.
2. Deploy `issue-playback-token` (and the other functions) to the sandbox.
3. Accounts to prepare in the bot's sandbox data: an entitled customer, a paid
   member with onboarding unfinished, a suspended member, a staff member with a
   staff-table name, and a staff member without one.
4. Check each account sees only its own name and Discord ID on the watermark, the
   unfinished, suspended and nameless-staff accounts are refused with the right
   message, and a wrong token shows "not configured" rather than a denial.
5. Revoke the entitled customer in the bot while their player is open: it must
   close within about 3.5 minutes. Stop the bot service: the open player must show
   "temporarily unavailable" and close within 5 minutes.
6. Fullscreen on desktop, browser and a phone: watermark stays visible.

### Web app

Follow [`web-hosting.md`](web-hosting.md): repository variables, DNS CNAME, Pages,
Supabase redirect URLs, Squarespace URL mapping, old-address redirect.

## Verified end to end

Not yet. Blocked on deploying the bot's member-access API to a sandbox, cloud
secrets, function deploys and a Bunny library.
