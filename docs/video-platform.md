# Mentorship video platform

## Status

| Layer | State |
| --- | --- |
| Edge Functions, migrations, client views, upload flow | Implemented on this branch |
| Unit tests (roles, permissions, validation, authorisation, playback pipeline, Bunny signing/API, Railway contract) | Tested with mocks (`npm test`) |
| Supabase secrets, migrations applied, functions deployed | Not done: owner action (see [`launch-checklist.md`](launch-checklist.md)) |
| Railway `POST /api/v1/member-access` | Specified in [`bot-handoff-member-access-api.md`](bot-handoff-member-access-api.md); not built or verified in the bot repo |
| End-to-end (real Discord + Railway + Bunny) | Not verified |

## Architecture

```
Customer app (Windows desktop or https://app.htnq.org)
  → Supabase Auth (Discord)
  → Edge Functions
       list-content | list-recordings | list-students     (listings, no playback URLs)
       create-upload | manage-content                     (staff)
       issue-playback-token                               (every play and renewal)
       verify-membership                                  (journal sync gate)
     → Discord API: live guild member + roles on every request
     → Railway mentorship API (POST /api/v1/member-access) on every playback
     → Bunny Stream: signed embed URLs, TUS upload signatures, video management
  → Bunny TUS endpoint (browser uploads files directly; never via Supabase)
```

The app never talks to Railway's database. Legal names are fetched at playback
time for the watermark and kept in memory only.

## Roles

Every request resolves capabilities from the caller's **live** Discord roles
(`supabase/functions/_shared/roles.ts`). Role IDs are built in and can be
overridden per environment with `DISCORD_ROLE_OWNER`, `DISCORD_ROLE_ADMIN`,
`DISCORD_ROLE_MENTOR`, `DISCORD_ROLE_STUDENT`, `DISCORD_ROLE_LEVEL_1..3`.

| Role | Discord role ID |
| --- | --- |
| Owner | 1498654518286618665 |
| Admin | 1499493868419420262 |
| Mentor | 1554810663799488553 |
| Student | 1502003458847281322 |
| Level 1 | 1504525385059270847 |
| Level 2 | 1504525684322730176 |
| Level 3 | 1504525483814158376 |

**Levels are inclusive:** the Level 3 role unlocks Levels 1, 2 and 3; Level 2
unlocks 1 and 2. Students also need the Student role. Staff (owner, admin,
mentor) see every level.

| | Owner / Admin | Mentor | Student |
| --- | --- | --- | --- |
| Level 1-3 tabs | All, including private and processing | All, including private and processing | Published + ready, up to their highest Level role |
| Lectures, Weekly Recaps & Outlooks | All | All | Published + ready |
| 1:1 recordings | Any student's | Any student's | Their own, published + ready |
| Upload | Every section; any student's recordings | Level 1-3; any student's recordings | No |
| Publish / make private | Everything | Level 1-3 and recordings | No |
| Edit title / description | Yes | No | No |
| Delete (also deletes in Bunny) | Yes | No | No |

The client only receives per-item permission flags. Every action is re-checked
on the server; sidebar locks are hints.

Email/password accounts have no Discord identity and cannot watch or manage
mentorship content. The earlier `video_staff_access` email bypass is removed.

## Sidebar

After **Learn**, a **Mentorship** group: Level 1, Level 2, Level 3, Lectures,
Weekly Recaps & Outlooks, then **Student Recordings** (staff: searchable
picker of Discord members with the Student role, then that student's
recordings and an upload button) or **My Recordings** (students). Learn is
unchanged.

## Authorisation chain (playback)

Before any signed URL is issued, `issue-playback-token`:

1. Validates the Supabase JWT.
2. Takes the Discord ID from the **linked Discord identity**, never from the request body.
3. Live-checks guild membership and roles. Discord rate limits or outages fail closed.
4. Applies the role rules above (private / unfinished items look "not found" to students).
5. Calls Railway mentorship access; requires `access: "allowed"` and a usable legal name.
   This applies to staff too, so staff need a Railway `staff_record` with a legal name.
6. Signs a short-lived Bunny **embed** URL and returns the watermark identity.

Every grant and denial is written to `playback_audit`. Uploads, visibility
changes, edits, deletes and status refreshes are written to `content_audit`.

## Uploads

1. Staff choose a file in the upload dialog. `create-upload` checks the live
   role, creates the Bunny video object with the library API key, inserts the
   row as **private / uploading**, and returns a TUS signature
   `SHA256(library_id + api_key + expiration + video_id)` valid for 24 hours.
2. The browser uploads straight to `https://video.bunnycdn.com/tusupload`
   with `tus-js-client` in 64 MB chunks with automatic retries. Multi-GB
   files are fine; Supabase never handles the file.
3. Pause / resume works in the dialog. If the window closes, choosing the same
   file again from the same device resumes it: `create-upload` re-signs only for
   the original uploader while Bunny still reports the video as not yet uploaded.
4. Bunny encodes the file. Staff listings poll Bunny for unfinished items
   (capped per request) and **Check status** forces a refresh.
5. Items stay private until published. The upload dialog can publish
   automatically; students only ever see items that are both published and
   finished processing.

For recordings, the target must currently be a guild member with the Student
role. Their Discord display name is stored as a label for staff lists (not a
legal name).

Deleting removes the Bunny video first and then soft-deletes the row, so a
failed Bunny delete never leaves a playable but unlisted file.

## Freshness and revocation

| Concern | Window |
| --- | --- |
| Journal/sync RLS (`authorized_members`) | 7 days (unchanged) |
| Mentorship listings and actions | Live Discord role check on every request |
| Playback | Live Discord + Railway check on every issue and renewal |
| Bunny embed token TTL | Default **12 minutes** (60 s-30 min) |
| In-app renewal | About 90 s before expiry, while the player stays open |

**Revocation honesty:** after a role or mentorship change, new plays fail
immediately. A player that is already open keeps playing until its next
renewal (at most about 10-11 minutes with defaults); the renewal re-runs every
check and closes the player if access was withdrawn. The renewal keeps the
already-loaded embed so the video does not restart, which means this close is
enforced by the app; a modified client could keep an open player running. We
do **not** promise instant CDN revocation.

## Bunny signing

- **Embed (the only delivery route returned to clients):**
  `token = SHA256_HEX(token_key + video_id + expires)`.
  Docs: https://docs.bunny.net/docs/stream-embed-token-authentication
- **TUS upload:** `SHA256_HEX(library_id + api_key + expiration + video_id)`.
  Docs: https://docs.bunny.net/reference/tus-resumable-uploads
- **HLS directory tokens:** implemented (advanced HMAC path tokens) but not
  returned to clients, so no weaker direct-stream URL undermines the model.

## Watermark and fullscreen

- Overlay text: `Full legal name · Discord user ID` (+ a short session reference).
- Applies to every video: Level, Lectures, Weekly Recaps and 1:1 recordings.
- Custom fullscreen on the **player shell** (iframe + overlay). The iframe is
  not granted fullscreen or picture-in-picture, so the native player cannot
  eject the watermark.
- Electron `setContentProtection` is best-effort and **not DRM**.
- The watermark is a deterrent and investigation aid. A DOM overlay can be
  removed by a determined user, and it does not prevent all screen recording
  or by itself establish a legal breach. Burned-in or provider-side
  watermarking is not implemented; do not buy add-ons without approval.

## Secrets (server only: Supabase Edge Function secrets)

Never use `VITE_` prefixes for these. Never put them in Electron bundles,
frontend JS, localStorage, git or screenshots.

```
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
MENTORSHIP_API_BASE_URL          # https://… Railway service
MENTORSHIP_API_TOKEN             # dedicated high-entropy credential
BUNNY_STREAM_LIBRARY_ID
BUNNY_STREAM_TOKEN_KEY           # Token Authentication key (embed signing)
BUNNY_STREAM_API_KEY             # Library API key (create/delete, TUS signing, status)
BUNNY_STREAM_CDN_HOSTNAME        # optional, thumbnails
PLAYBACK_TTL_SECONDS             # optional, default 720
DISCORD_ROLE_*                   # optional overrides of the built-in role IDs
MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1   # local mock testing only; never in production
```

The Discord bot needs **Server Members Intent** for the student search.

Client env (public by design) only has:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Database

Apply in order (both idempotent, both appended to `schema.sql`):

- `20261008_video_platform.sql`: `videos`, `member_levels`, `video_staff_access` (now unused), `playback_audit`.
- `20261016_roles_sections_recordings.sql`: adds `section`, `visibility`, `encoding_status`,
  `uploaded_by_discord_id`, `deleted_at` to `videos`; makes `level` nullable for
  Lectures / Weekly Recaps; adds `student_recordings`, `content_audit` and
  `playback_audit.recording_id`; drops the client select policy on `videos`.

All mentorship tables are read and written only by Edge Functions (service role).
The owner chooses audit retention.

## Price context

Advertised price changes are **not** encoded here. Video access depends on the
bot's agreement-aware Railway decision, not a hard-coded amount.
