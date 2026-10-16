# Test report: mentorship video platform

Date: 2026-10-16
Branch: `cursor/mentorship-video-platform-7f95`

## Automated (mocked / unit): `npm test`

88 tests, all passing.

| Area | Coverage |
| --- | --- |
| Roles (`tests/roles.test.ts`) | Built-in IDs, env overrides (snowflake-validated), inclusive levels, owner/admin/mentor/student/none capabilities |
| Permissions (`tests/decisions.test.ts`) | Listing, playback, upload per section, visibility, edit, delete, recordings, upload resume |
| Validation (`tests/validation.test.ts`) | Identity fields rejected, exactly one playback target, section/level rules, recording targets and dates, resume mode, manage actions, search bounds |
| Authorisation (`tests/authz.test.ts`) | Missing token, invalid/expired session, no Discord identity, not a member (+ revocation, + revocation failure), Discord rate limit / error / unreachable, live capabilities |
| Playback pipeline (`tests/playback.test.ts`) | Success + watermark + no PII in URL, higher level denied before Railway, private/unfinished hidden from students, staff "processing", staff private preview still checked by Railway, Railway denied / outage / ID mismatch / misconfigured, missing legal name, recording isolation |
| Bunny (`tests/bunnyAuth.test.ts`, `tests/bunnyApi.test.ts`) | Embed token, HLS path token, TUS signature, create/get/delete with AccessKey, fail-closed errors, status mapping |
| Railway contract (`tests/mentorshipApi.test.ts`) | allowed/denied parsing, ID mismatch, leaked name on deny, placeholders, timeout vs denial, bounded retries, HTTPS-only (localhost only with explicit flag), constant-time compare |
| Identity / constants (`tests/videoAccess.test.ts`) | Discord ID from linked identity only, client inclusive-level helper, TTL bounds |

These tests **do not** call real Discord, Railway, Supabase or Bunny.

## Static checks

- `npm run typecheck`: passes (renderer, main, preload, shared).
- `deno check` on every Edge Function entry point: passes.
- `npm run build:web`: passes.

## Explicit test-only mock

`tests/mocks/mentorshipAccessMock.ts` is a local HTTP mock of the Railway contract.
It must never be substituted for production access decisions.

## Real integration / sandbox

**Not run in this environment.** Requires owner-configured secrets, applied
migrations, deployed functions, live Discord roles, the Railway API and a Bunny library.

Planned sandbox checks:

1. Each account receives only its own watermark identity.
2. A student with Level 2 sees Levels 1-2 but not 3; a non-student sees nothing.
3. A mentor can upload Level videos and recordings, publish/make private, and cannot upload Lectures/Weekly or delete.
4. A student sees only their own published recordings; another student's recording ID returns "not found".
5. A multi-GB upload survives a pause, a network drop and a window close (resume by choosing the same file).
6. Copied/expired playback URL fails after the TTL.
7. Long lesson: seek + renewal while the player is open without restarting.
8. Revocation: new plays fail immediately; an open player closes at its next renewal.
9. Watermark visible in desktop, browser and the custom fullscreen.

## Claims not made

- Mobile OS capture blocking
- DRM / MediaCage
- Real CDN validation of signed URLs
- End-to-end Railway integration (bot API not available here)
