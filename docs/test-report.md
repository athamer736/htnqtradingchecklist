# Test report: mentorship video platform

Date: 2026-10-16
Branches: `cursor/mentorship-video-platform-7f95`, `cursor/member-access-integration-6f61`

## Automated (mocked / unit): `npm test`

173 tests, all passing.

| Area | Coverage |
| --- | --- |
| Roles (`tests/roles.test.ts`) | Built-in IDs, env overrides (snowflake-validated), inclusive levels, owner/admin/mentor/student/none capabilities |
| Permissions (`tests/decisions.test.ts`) | Listing, playback, upload per section, visibility, edit, delete, recordings, upload resume |
| Validation (`tests/validation.test.ts`) | Identity fields rejected, exactly one playback target, section/level rules, recording targets and dates, resume mode, manage actions, search bounds |
| Authorisation (`tests/authz.test.ts`) | Missing token, invalid/expired session, no Discord identity, not a member (+ revocation, + revocation failure), Discord rate limit / error / unreachable, live capabilities |
| Playback pipeline (`tests/playback.test.ts`) | Success + watermark + no PII in URL, higher level denied before Railway, private/unfinished hidden from students, staff "processing", staff private preview still checked by Railway, Railway denied / outage / ID mismatch / misconfigured, no legal name needed (`identity_unresolved` plays with just the Discord ID); legal name on the watermark (bot's name wins, admin-entered fallback, unusable or unreadable stored names skipped, never in the URL/audit, stored name never bypasses a denial), recording isolation |
| Bunny (`tests/bunnyAuth.test.ts`, `tests/bunnyApi.test.ts`) | Embed token, HLS path token, TUS signature, create/get/delete with AccessKey, fail-closed errors, status mapping |
| Bot contract (`tests/mentorshipApi.test.ts`, 50) | Exact request shape (token only in the header); every reason code; 30 malformed responses rejected (schema version, mismatched/numeric ID, timestamps, recheck, extra fields, names, identity source, denial leaks); 300 s recheck cap; origin-only HTTPS base URL; 401/403 misconfigured without retry; 429 with Retry-After, no retry; 503 bounded retries; timeout; non-JSON / oversized / odd status; no console output |
| Playback + member access (`tests/playback.test.ts`, 24) | Entitled customer gets their own watermark looked up by the verified ID; paid but unfinished onboarding denied; suspended / inactive / not found; staff with and without a name record (both can watch); `staff_record` without a live staff role refused; 401/429/503/timeout mapping; nothing signed on denial; grant window capped at 300 s |
| Revalidation (`tests/playbackSession.test.ts`, 16) | Grant timing from client receipt, 300 s cap, renew/expire ticks, revocation closes immediately, temporary failures retried with backoff and Retry-After but never past the deadline, simulated hour of playback, revocation and outages |
| Integration with the test-only bot mock (`tests/memberAccessIntegration.test.ts`, 12) | Real HTTP client and playback pipeline against `tests/mocks/mentorshipAccessMock.ts` on localhost: the same customer, onboarding, suspension, staff, client-supplied-ID, wrong-token, 429, 503 and timeout cases; audit rows without names |
| Client secrets and logs (`tests/clientSecrets.test.ts`, 7) | No backend secret names, bot endpoint or tokens in client sources, build config, workflows or built bundles; only public `VITE_SUPABASE_*` vars; no console output in Edge Functions; playback client code neither logs nor persists |
| Admin-entered legal names (`tests/memberNames.test.ts`, 37) | Owner/admin only; set/clear request validation (snowflake target, 2-200 letters, placeholders, control/bidi characters, client-supplied identity fields rejected, no name on clear); lookup shows bot and stored names side by side and still works with the bot denied, down or unconfigured, without leaking upstream text; audit outcomes never contain a name |
| Identity / constants (`tests/videoAccess.test.ts`) | Discord ID from linked identity only, client inclusive-level helper, TTL bounds |

These tests **do not** call real Discord, the real bot, Supabase or Bunny. The
integration file exercises the platform's own modules over HTTP against a
test-only mock; it is not a cross-service test.

## Static checks

- `npm run typecheck`: passes (renderer, main, preload, shared).
- `deno check` on every Edge Function entry point: passes.
- `npm run build:web`: passes; the fresh bundle was scanned by `tests/clientSecrets.test.ts`.

## Explicit test-only mock

`tests/mocks/mentorshipAccessMock.ts` is a local HTTP mock of the Railway contract.
It must never be substituted for production access decisions.

## Real integration / sandbox

**Not run.** Requires owner-configured sandbox secrets, applied migrations,
deployed functions, live Discord roles, a sandbox deployment of the bot's
member-access API (draft PR #10) and a Bunny library. Steps:
[`launch-checklist.md`](launch-checklist.md#sandbox-test-before-production).

Planned sandbox checks:

1. Each account receives only its own watermark identity.
2. A student with Level 2 sees Levels 1-2 but not 3; a non-student sees nothing.
3. A mentor can upload Level videos and recordings, publish/make private, and cannot upload Lectures/Weekly or delete.
4. A student sees only their own published recordings; another student's recording ID returns "not found".
5. A multi-GB upload survives a pause, a network drop and a window close (resume by choosing the same file).
6. Copied/expired playback URL fails after the TTL.
7. Long lesson: seek + renewal while the player is open without restarting.
8. Revocation: new plays fail immediately; an open player closes at its next re-check (≤ ~3.5 min), or within 5 min if the bot is unreachable.
9. Watermark visible in desktop, browser and the custom fullscreen.

## Claims not made

- Mobile OS capture blocking
- DRM / MediaCage
- Real CDN validation of signed URLs
- End-to-end bot integration (bot PR #10 not deployed; bot repository not readable from this agent)
