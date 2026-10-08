# Mentorship video platform

## Status of this checkout

The previous inspection assumed video files already existed. On `main` at the
start of this work they did **not**: there was Discord login +
`verify-membership` only. This document describes what was implemented in this
branch.

## Architecture

```
Customer app (Electron / web)
  → Supabase Auth (Discord)
  → Edge Functions (verify-membership | list-videos | issue-playback-token)
       → Discord API (guild membership + Level roles)
       → Railway mentorship API (POST /api/v1/member-access)
       → Bunny Stream (signed embed URL only)
```

The browser/desktop app never talks to Railway’s database. Legal names are
fetched at playback time for the watermark and are kept in memory only.

## Authorisation chain (playback)

Before any signed URL is issued, `issue-playback-token` must:

1. Validate the Supabase JWT.
2. Resolve the Discord ID from the **linked Discord identity** (not request body / metadata).
3. Live-check guild membership and Level 1/2/3 roles (not the 7-day sync window).
4. Confirm the requested video’s level is in the member’s roles (higher ≠ lower).
5. Call Railway mentorship access; require `access: "allowed"` and a usable legal name.
6. Sign a Bunny **embed** URL with a short TTL and return watermark identity.

Email/password staff accounts have no Discord identity. They need an explicit
row in `video_staff_access` (no fabricated customer identities).

## Freshness and revocation

| Concern | Window |
|--------|--------|
| Journal/sync RLS (`authorized_members`) | 7 days (unchanged) |
| Video Discord roles | Live check on every issue/list; cached row replaced atomically |
| Railway entitlement | Live check on every playback issue |
| Bunny embed token TTL | Default **12 minutes** (max 30); client renews ~90s early |

**Revocation honesty:** if a member loses a role or mentorship access, new
playback issues fail immediately (fail closed). An already-issued Bunny URL can
still play until its TTL expires (up to ~12 minutes by default). We do **not**
promise instant CDN revocation.

If `member_levels` cannot be replaced after a role change, levels are wiped so
video access fails closed. Journal access is separate and is not locked solely
because video role persistence failed.

## Bunny signing

- **Embed (used in production response):**
  `token = SHA256_HEX(security_key + video_id + expires)`  
  Docs: https://bunny.net/docs/stream/token-authentication
- **HLS directory tokens (implemented, not returned to clients):**
  Advanced HMAC-SHA256 path-based `bcdn_token` so playlist + segments inherit auth.  
  Docs: https://docs.bunny.net/cdn/security/token-authentication/advanced

Returning only the embed route prevents a weaker direct-stream URL from
undermining the web protection model. Client-supplied “desktop vs web” flags
are not a security boundary.

## Watermark and fullscreen

- Overlay text: `Full legal name · Discord user ID` (+ optional `sessionRef`).
- Custom fullscreen on the **player shell** (iframe + overlay). The iframe is
  not granted `allow="fullscreen"` so native player fullscreen / PiP cannot
  eject the watermark.
- Electron `setContentProtection` is best-effort and **not DRM**.
- A DOM overlay can be removed by a determined user. Stronger provider-backed
  or burned-in watermarking is a later option and is **not** implemented; do
  not purchase add-ons without approval.

## Secrets (server only — Supabase Edge Function secrets)

Never use `VITE_` prefixes for these. Never put them in Electron bundles,
frontend JS, localStorage, git, or screenshots.

```
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_ROLE_LEVEL_1
DISCORD_ROLE_LEVEL_2
DISCORD_ROLE_LEVEL_3
MENTORSHIP_API_BASE_URL          # https://… Railway service
MENTORSHIP_API_TOKEN             # dedicated high-entropy credential
BUNNY_STREAM_LIBRARY_ID
BUNNY_STREAM_TOKEN_KEY           # Token authentication key (not the library API key)
PLAYBACK_TTL_SECONDS             # optional, default 720
VIDEO_ROLE_MAX_AGE_SECONDS       # optional, default 900
MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1   # test mock only
```

Client `.env` still only has:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Database

Apply `supabase/migrations/20261008_video_platform.sql` (also appended to
`schema.sql`):

- `videos` — catalogue
- `member_levels` — Discord role snapshot (service-written)
- `video_staff_access` — explicit staff path
- `playback_audit` — minimal investigation trail (service-only; **owner chooses retention**)

## Privacy note (draft for owner — not legal advice)

> When you watch mentorship videos we retrieve your legal name from your
> mentorship joining records so we can display it with your Discord user ID on
> the player as a personalised watermark. We use this to discourage unauthorised
> sharing and to investigate suspected misuse. Names are requested when needed
> for playback rather than copied indefinitely into a second customer database.
> Short-lived technical logs of playback grants/denials may be kept to operate
> the service; retention is set by HTNQ. Watermarking is not a guarantee against
> all recording and does not by itself establish a legal breach.

## Price context

Advertised price changes (e.g. £1,500) are **not** encoded here. Video access
depends on the bot’s agreement-aware Railway decision, not a hard-coded amount.

## Configuration still required before launch

See `docs/launch-checklist.md` and `docs/bot-handoff-member-access-api.md`.
