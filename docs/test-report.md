# Test report — mentorship video platform

Date: 2026-10-08  
Branch: `cursor/mentorship-video-platform-7f95`

## Automated (mocked / unit) — run with `npm test`

| Area | Coverage |
|------|----------|
| Mentorship contract parse | allowed, denied, discord_id mismatch, leaked name on deny, placeholders |
| Mentorship fetch | denial vs timeout, missing endpoint, non-HTTPS base |
| Credential compare | timingSafeEqualString |
| Bunny embed signing | SHA256(key+videoId+expires) hex |
| Bunny HLS signing | separate HMAC path-based token (not returned to clients) |
| Role mapping | higher level does not include lower; multi-level |
| Discord identity | from linked identity only |
| Policy constants | TTL ≪ 6h; video freshness ≪ 7d |

These tests **do not** call real Discord, Railway, Supabase, or Bunny.

## Explicit test-only mock

`tests/mocks/mentorshipAccessMock.ts` — local HTTP mock of the Railway contract.
Must never be substituted for production access decisions.

## Real integration / sandbox

**Not run in this environment.** Requires owner-configured secrets, deployed
functions, live Discord roles, Railway API, and Bunny library.

Planned sandbox checks (two accounts):

1. Each account receives only its own watermark identity.
2. Customer without entitlement cannot obtain a playable URL.
3. Copied/expired playback URL fails after TTL (documented policy).
4. Long lesson: seek + renew while player open.
5. Revocation within documented window (new issues fail immediately; CDN TTL lag).
6. Watermark visible in supported desktop/browser/fullscreen/mobile modes.

## Typecheck / build

See CI notes in the PR after `npm run typecheck` / `npm run build:web`.

## Claims not made

- macOS Gatekeeper / notarization behaviour
- Mobile OS capture blocking
- MediaCage / DRM
- Real CDN validation of signed URLs
- End-to-end Railway integration (bot API not available here)
