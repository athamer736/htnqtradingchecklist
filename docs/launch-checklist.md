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

## Tested

- [x] `npm test`: roles, permission matrix, request validation, authorisation pipeline,
      playback pipeline (Railway denied / outage / mismatch / missing name, private, level, not ready),
      Bunny embed + TUS signing, Bunny API helpers, Railway contract (all mocked)
- [x] `npm run typecheck`, `npm run build:web`, `deno check` on every Edge Function
- [ ] Real Supabase Edge Function deploy
- [ ] Real Railway endpoint
- [ ] Real Bunny library: upload, encode, signed embed playback
- [ ] Two-account sandbox: watermark identity, denial, recording isolation
- [ ] Mobile capture blocking / DRM (not claimed)

## Configure in the cloud (owner)

### Supabase SQL

Apply in order (both idempotent; both are also appended to `schema.sql`):

1. `supabase/migrations/20261008_video_platform.sql`
2. `supabase/migrations/20261016_roles_sections_recordings.sql`

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
supabase functions deploy issue-playback-token
supabase functions delete list-videos
```

### Bunny

1. Enable **Embed view token authentication** on the library.
2. `BUNNY_STREAM_TOKEN_KEY` = the library **Token Authentication key**.
3. `BUNNY_STREAM_API_KEY` = the library **API key** (Stream → library → API).
4. Prefer blocking unsigned embeds / hotlinking.

### Railway bot

1. Implement `POST /api/v1/member-access` per `docs/bot-handoff-member-access-api.md`,
   including `staff_record` names for owner/admin/mentor accounts.
2. Issue dedicated prod/test credentials.
3. Point `MENTORSHIP_API_BASE_URL` / `MENTORSHIP_API_TOKEN` at production.

### Web app

Follow [`web-hosting.md`](web-hosting.md): repository variables, DNS CNAME, Pages,
Supabase redirect URLs, Squarespace URL mapping, old-address redirect.

## Verified end to end

Not yet. Blocked on the bot API, cloud secrets, function deploys and a Bunny library.
