# Mentorship video platform

## Status

| Layer | State |
| --- | --- |
| Edge Functions, migrations, client views, upload flow | Implemented on this branch |
| Unit tests (roles, permissions, validation, authorisation, playback pipeline, Bunny signing/API, Railway contract) | Tested with mocks (`npm test`) |
| Supabase secrets, migrations applied, functions deployed | Not done: owner action (see [`launch-checklist.md`](launch-checklist.md)) |
| Railway `POST /api/v1/member-access` | Implemented in the bot's draft PR #10 (not merged or deployed). Platform client matched to the relayed contract; see [`bot-handoff-member-access-api.md`](bot-handoff-member-access-api.md) |
| End-to-end (real Discord + Railway + Bunny) | Not verified |

## Architecture

```
Customer app (Windows desktop or https://app.htnq.org)
  → Supabase Auth (Discord)
  → Edge Functions
       list-content | list-recordings | list-students     (listings, no playback URLs)
       create-upload | manage-content | set-thumbnail     (staff)
       admin-members | admin-member-identity | admin-member-name   (owner/admin: Admin panel)
        level-descriptions                                 (text at the top of each Mentorship page)
        issue-playback-token                                (every play and renewal)
       verify-membership                                  (journal sync gate)
     → Discord API: live guild member + roles on every request
     → Railway mentorship API (POST /api/v1/member-access) on every playback
     → Bunny Stream: signed embed URLs, TUS upload signatures, video management
  → Bunny TUS endpoint (browser uploads files directly; never via Supabase)
```

The app never talks to Railway's database. The playback watermark always shows the
viewer's own Discord ID and current Discord username, plus their legal name when one is on file (the bot's name
first, else the one an admin entered), so no legal name is needed to watch. Names
are only ever sent back to that same verified viewer, and are listed or looked up
by owners and admins on request.

## Roles

Every request resolves capabilities from the caller's **live** Discord roles
(`supabase/functions/_shared/roles.ts`). Role IDs are built in and can be
overridden per environment with `DISCORD_ROLE_OWNER`, `DISCORD_ROLE_ADMIN`,
`DISCORD_ROLE_MENTOR`, `DISCORD_ROLE_STUDENT`, `DISCORD_ROLE_LEVEL_1..3`. The batch
roles use `JULY_BATCH`, `SEPT_BATCH` and `BATCH_5`.

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
unlocks 1 and 2. Students also need the Student role. Since 2.0.3 these rules are the *seeded
defaults* of editable tabs (below); the table describes the seeded tabs.

| | Owner / Admin | Mentor | Student |
| --- | --- | --- | --- |
| Level 1-3 tabs | All, including private and processing | All, including private and processing | Published + ready, up to their highest Level role |
| Further Studying | All, including private and processing | All, including private and processing | Published + ready, with the Level 3 role |
| 1st Of July Batch, 1st Of September Batch, Batch 5.0 | All, including private and processing | All, including private and processing | Published + ready, only the batch(es) whose Discord role they hold |
| Lectures, Weekly Recaps & Outlooks | All | All | Published + ready |
| 1:1 recordings | Any student's | Any student's | Their own, published + ready |
| Upload | Every section; any student's recordings | Level 1-3, Further Studying and the batch sections; any student's recordings | No |
| Publish / make private | Everything | Level 1-3 and recordings | No |
| Edit title / description | Yes | No | No |
| Delete (also deletes in Bunny) | Yes | No | No |
| Reorder videos within a section / Level | Yes | No | No |
| Write the description shown on a Level or section page | Yes | No | No |
| Read a Level's description | All Levels | All Levels | Levels their roles unlock |
| Admin panel: members list (live roles and levels) | Yes | No | No |
| Admin panel: look up a member's legal name (live from the bot, audited) | Yes | No | No |

Descriptions are multi-line. The server keeps line breaks (and drops other
control and bidi characters; cap 2000 characters). The player shows the title and
description in a side panel that viewers can close, rendered as React elements,
never HTML, with a small set of marks: blank line = new paragraph, `# Heading`,
`## Heading`, `- bullet`, `1. numbered`, `**bold**`, `*italic*`. Links and images
are not supported (`src/shared/richText.ts`).

The client only receives per-item permission flags. Every action is re-checked
on the server. The sidebar only lists the Mentorship pages the member's Discord
roles open (`src/shared/mentorshipNav.ts`), so someone without Level 3 never
sees the Level 3 tab and members without the Student role see no Mentorship
group. That is navigation only: a hidden page's videos are still refused by the
server.

Email/password accounts have no Discord identity and cannot watch or manage
mentorship content. The earlier `video_staff_access` email bypass is removed.

## Sidebar

Under **Setup**, a **Mentorship** group made of the tabs the member may open (admin-editable since 2.0.3; seeded as Level 1-3, Further Studying, Lectures,
Weekly Recaps & Outlooks, 1st Of July Batch, 1st Of September Batch, Batch 5.0), then **Student Recordings** (staff: searchable
picker of Discord members with the Student role, then that student's
recordings and an upload button) or **My Recordings** (students).

Owners and admins (and any Tab manager role) also get an **Admin** item (shown from the server-computed
`isManager` / `canManageTabs` capabilities); Members and Library are owner/admin only, **Tabs** is for tab managers:

- **Members**: everyone in the mentorship server who holds a staff, Student or
  Level role (`admin-members`). Roles and effective levels come live from
  Discord and are read-only: levels and staff roles are changed in Discord. A
  member with a Level role but no Student role is flagged because none of their
  levels unlock. Legal names are **not** listed (only a "Name on file" /
  "No name added" flag, with a filter for members still missing one).
  **Legal name** on a member calls `admin-member-identity`, which returns two
  things side by side: what the bot reports for that one member (live, never
  stored here) and the name an admin recorded. It records the lookup (Discord IDs
  only, never a name) in `content_audit`. Names live in memory while the panel
  is open. The admin-entered name is added, changed or removed from the same
  panel via `admin-member-name`; it is stored in `member_legal_names`
  (service-role only, Discord ID -> name), is an admin reference only, is never
  sent to the player or used for any access decision, and each change is audited
  with who/whom but never the name. It works for any member, including those the
  bot has no name for, and does not change anything in the bot.
- **Tabs** (2.0.3): add, rename, describe, reorder (Up / Down) and delete Mentorship tabs. Each tab has three
  any-of role lists: **view** (empty = every Student), **upload** and **manage** (edit, delete, reorder, write the
  description). The Student role is always required to view; owner/admin always have full access, and mentors do not
  need the Student role but must be on the view list (or the list must be empty). A role on a tab's upload or manage
  list also opens that tab. A tab can only be deleted when it has no videos. Only the owner edits the **Tab managers**
  list (which roles may manage tabs; admins by default). Backed by `manage-tabs`, tables `mentorship_tabs` and
  `mentorship_settings`, and `videos.tab_id`. Changes are written to `content_audit` (`tab_created`, `tab_updated`,
  `tab_roles_changed`, `tab_deleted`, `tab_managers_changed`).
- **Library**: every video grouped by tab, in
  the order members see, with **Up / Down** (`manage-content` `move`),
  publish / make private, edit and delete. Upload still happens on each
  section's page.

## Authorisation chain (playback)

Before any signed URL is issued, `issue-playback-token`:

1. Validates the Supabase JWT.
2. Takes the Discord ID from the **linked Discord identity**, never from the request body.
3. Live-checks guild membership and roles. Discord rate limits or outages fail closed.
4. Applies the role rules above (private / unfinished items look "not found" to students).
5. Calls the bot's `POST /api/v1/member-access` for **that** Discord ID, only
   to get the viewer's legal name. **The bot never blocks playback** (owner
   decision, 2026-10-20): only members of the private mentorship server can sign
   in, so steps 1-4 decide access. Whatever the bot answers (denied, not found,
   misconfigured or unreachable), a member with the right roles still plays; the
   watermark then just has no bot name. A `staff_record` name is only used while
   the viewer holds a live staff role. To cut someone off, remove their Discord
   roles or remove them from the server.
6. Picks the watermark name: the bot's `legal_name` if it supplied one, otherwise
   the admin-entered name in `member_legal_names` for that same verified Discord
   ID (re-validated; an unusable value is skipped, and a failed read just means no
   name). A stored name never changes an access decision.
7. Signs a short-lived Bunny **embed** URL and returns the watermark (Discord ID,
   current Discord username from the live member lookup, the viewer's own legal
   name when there is one, and a session reference) and the
   access window (`accessValidForSeconds`, at most 300 s). The name is never put in
   the URL, `playback_audit` or logs.

Every grant and denial is written to `playback_audit`. Uploads, visibility
changes, edits, deletes, reorders, status refreshes and Admin-panel legal-name
lookups are written to `content_audit`.

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
| Playback | Live Discord + bot check on every issue and renewal |
| Allowed decision | Valid for the bot's `recheck_after_seconds`, **capped at 300 s** (floor 30 s) |
| In-app revalidation | At 210 s by default (300 s minus 90 s); temporary failures retried after 5/10/20 s (or `Retry-After` if longer), never past the 300 s deadline |
| Bunny embed token TTL | `min(PLAYBACK_TTL_SECONDS, access window + 90 s)`: **390 s** by default |

The client measures the window from when it received the response (so server
clock skew can't extend it), checks every 2 s and whenever the tab regains
focus, and closes the player when the window lapses without a successful
re-check. A denial on re-check (role removed, left the server) closes it
immediately; the bot's answer no longer affects it. "Temporarily unavailable" and "access
expired" are shown differently from membership denials.

**Revocation honesty:** after a role or mentorship change, new plays fail
immediately, and an open player stops at its next re-check (at most about
3.5 minutes later with defaults). The re-check keeps the already-loaded embed so
the video does not restart, which means this close is enforced by the app; a
modified client could keep an open player running until Bunny's embed token
expires. We do **not** promise instant CDN revocation.

## Bunny signing

- **Embed (the only delivery route returned to clients):**
  `token = SHA256_HEX(token_key + video_id + expires)`.
  Docs: https://docs.bunny.net/docs/stream-embed-token-authentication
- **TUS upload:** `SHA256_HEX(library_id + api_key + expiration + video_id)`.
  Docs: https://docs.bunny.net/reference/tus-resumable-uploads
- **HLS directory tokens:** implemented (advanced HMAC path tokens) but not
  returned to clients, so no weaker direct-stream URL undermines the model.

## Watermark and fullscreen

- Overlay text: the viewer's legal name (when one is on file), their current
  Discord username as `@username`, and `Discord ID <viewer's ID>` (+ a short
  session reference). The ID comes from the verified linked Discord identity,
  never from the request. The username comes from the live guild member lookup
  done on every play, so a rename shows up on the next play; if Discord doesn't
  return a usable one it is simply left out. None of these are placed in URLs.
- Applies to every video: Level, Lectures, Weekly Recaps and 1:1 recordings.
- Moves every 12 s within the upper ~75% of the player so the Bunny controls
  stay usable; text scales with the player width (11-22 px), so it stays
  legible in fullscreen and small on phones.
- Custom fullscreen on the **player shell** (iframe + overlay). The iframe is
  not granted fullscreen or picture-in-picture, so the native player cannot
  eject the watermark. Where element fullscreen isn't available (iPhone
  Safari) or is blocked, the shell expands to fill the page instead, with an
  in-player exit button. That isn't true OS fullscreen: the browser UI may
  stay visible.
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
MENTORSHIP_API_BASE_URL          # bot's HTTPS origin on Railway, no path
MENTORSHIP_API_TOKEN             # = the bot's MEMBER_ACCESS_API_TOKEN
BUNNY_STREAM_LIBRARY_ID
BUNNY_STREAM_TOKEN_KEY           # Token Authentication key (embed + thumbnail signing)
BUNNY_STREAM_API_KEY             # Library API key (create/delete, TUS signing, status)
BUNNY_STREAM_CDN_HOSTNAME        # optional, thumbnails
PLAYBACK_TTL_SECONDS             # optional upper bound, default 720 (capped to access window + 90 s)
DISCORD_ROLE_*                   # optional overrides of the built-in role IDs
JULY_BATCH / SEPT_BATCH / BATCH_5   # batch role IDs (built in; set here too)
MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1   # local mock testing only; never in production
```

The Discord bot needs **Server Members Intent** for the student search.

Bunny library **Security** settings:

- **Embed view token authentication**: on (every embed URL is signed).
- **CDN token authentication**: on, set on the library's **Security** page (not
  on the `vz-…` CDN zone). Every file request then needs a signature that
  expires; unsigned requests get 403. `list-content` signs thumbnail URLs
  (valid 6-12 hours) with the same key.
- **MediaCage Basic DRM**: off. Bunny can't combine it with CDN token
  authentication; with both on, every video shows "not available".
- **Enable direct play**: on. The embedded player needs it. With CDN tokens on,
  a bare video ID still can't open a video.
- **Block direct url file access**: off. It relies on a `Referer` header, which
  iPhone/iPad Safari's built-in video player doesn't send.

Client env (public by design) only has:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Database

Apply in order (all idempotent, all appended to `schema.sql`):

- `20261008_video_platform.sql`: `videos`, `member_levels`, `video_staff_access` (now unused), `playback_audit`.
- `20261024_mentorship_tabs.sql`: `mentorship_tabs` (seeded with the nine original sections and their role lists),
  `mentorship_settings` (tab managers), `videos.tab_id` (backfilled; a trigger keeps 2.0.2 uploads working),
  `section = 'custom'` and the new `content_audit` actions. The `JULY_BATCH` / `SEPT_BATCH` / `BATCH_5` env vars are no longer used.
- `20261016_roles_sections_recordings.sql`: adds `section`, `visibility`, `encoding_status`,
  `uploaded_by_discord_id`, `deleted_at` to `videos`; makes `level` nullable for
  Lectures / Weekly Recaps; adds `student_recordings`, `content_audit` and
  `playback_audit.recording_id`; drops the client select policy on `videos`.
- `20261018_admin_panel.sql`: widens `content_audit` for the `reordered` and
  `member_name_viewed` actions and a `member` target (Discord id in the new
  `target_discord_id` column; `target_id` becomes nullable).
- `20261019_member_legal_names.sql`: `member_legal_names` (Discord id -> admin-entered
  legal name, RLS on, no client policies, client grants revoked) and the
  `member_name_set` / `member_name_cleared` audit actions.

All mentorship tables are read and written only by Edge Functions (service role).
The owner chooses audit retention.

## Price context

Prices are **not** encoded in the platform (the current advertised price of
£2,000 lives with the bot's onboarding). Video access depends on the bot's
agreement-aware decision, so existing members keep access under the prices
they agreed, and no amount is hard-coded here.
