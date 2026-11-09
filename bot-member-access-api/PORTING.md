# Porting `POST /api/v1/member-access` into the H4STH2 Mentorship bot

Instructions for the agent working in the bot repository (the mentorship
enquiries and sign-up bot on Railway, not the tool's login bot).

The HTNQ Trading Checklist video platform calls this endpoint server-to-server
on every video playback to ask: "may this Discord ID watch, and under what
legal name (for the watermark)?" Build it in the bot repo, deriving the answer
from the bot's EXISTING joining logic. Open a draft PR. Do not deploy.

## Sources

- Reference implementation (this folder):
  `athamer736/htnqtradingchecklist`, branch `cursor/bot-member-access-api-6f61`,
  path `bot-member-access-api/` (`src/`, `tests/`, `README.md`).
  PR: https://github.com/athamer736/htnqtradingchecklist/pull/9
- Contract (source of truth): same repo, branch
  `cursor/mentorship-video-platform-7f95`, `docs/bot-handoff-member-access-api.md`.

If the bot is Node/TypeScript or JavaScript, port the module (adapt it to the
bot's module system, HTTP server and test runner), keeping its behaviour and
tests. If the bot uses another language, re-implement to the spec below with
equivalent tests.

## Step 1: investigate before writing code

Find and read the bot's existing code for: enquiries/applications, the joining
flow and what marks joining "complete", payment plans/agreed prices and how
payment is checked, the NDA (signing, `signed_name`, voiding/replacement), Terms
acceptance and Terms versions, early access / waiting periods, identity
verification, suspension/cancellation/bans, staff roles, the database layer,
and whether the bot already runs an HTTP server (Railway needs it to listen on
`process.env.PORT`).

Reuse those existing helpers and queries. Do not write new, parallel
eligibility conditions that could disagree with the joining flow. If a fact the
endpoint needs doesn't exist in the bot, don't invent it: make the safe choice
(deny) and list it in the PR as an open question.

## Hard rules

- Auth: a new dedicated env var `MEMBER_ACCESS_API_TOKEN`, sent as
  `Authorization: Bearer <token>`. Compare in constant time (SHA-256 both sides,
  then `crypto.timingSafeEqual`; compare against every configured credential
  without early exit). Optional `MEMBER_ACCESS_API_TOKEN_PREVIOUS` for rotation.
  Refuse to start if the token is missing, shorter than 32 chars, or equal to
  the value of any other env var. Never reuse Stripe, Discord, Supabase,
  database or Checkout credentials. Error messages name env vars, never values.
- Never log legal names, tokens, raw request bodies, database URLs or DB error
  messages. Log: request id, status, access, reason_code, credential label
  (current/previous), last 4 digits of the Discord ID, duration.
- Responses never contain addresses, phone numbers, payment references,
  document images or contracts. Denied responses never contain `legal_name`.
- Don't deploy, don't change Railway settings, don't print or commit secrets
  or database URLs.
- Don't hard-code a price. Payment means "paid what this member's own agreement
  requires", using the bot's existing agreement logic. Existing customers keep
  their agreed prices and valid document history.
- An archived enquiry thread is not cancellation: successful joining archives
  the enquiry on purpose. Never derive "membership ended" from thread state.

## Endpoint contract

```
POST /api/v1/member-access
Authorization: Bearer <token>
Content-Type: application/json

{ "discord_id": "123456789012345678" }      // string only, never a number
```

Allowed (200):

```json
{ "schema_version": 1, "discord_id": "<id>", "access": "allowed",
  "legal_name": "<name>", "identity_source": "signed_nda",
  "checked_at": "2026-10-16T12:00:00Z", "recheck_after_seconds": 300 }
```

`identity_source` is `signed_nda` or `staff_record`.

Denied (200):

```json
{ "schema_version": 1, "discord_id": "<id>", "access": "denied",
  "reason_code": "onboarding_incomplete",
  "checked_at": "2026-10-16T12:00:00Z", "recheck_after_seconds": 300 }
```

`reason_code` is one of `onboarding_incomplete`, `nda_missing`,
`payment_incomplete`, `membership_inactive`, `suspended`, `not_found`,
`identity_unresolved`.

Every response sends `Cache-Control: no-store`, `Content-Type: application/json`
and `X-Content-Type-Options: nosniff`. Error bodies are `{ "error": "<code>" }`.

## HTTP behaviour

| Condition | Response |
| --- | --- |
| Other path | pass to next handler, or 404 |
| Not POST | 405, `Allow: POST` |
| Missing/malformed/wrong Bearer token | 401, `WWW-Authenticate: Bearer`, body not read |
| > 10 failed auths/min from one IP | 429 + `Retry-After`; must not block the valid token |
| Content-Type not `application/json` | 415 |
| Body > 1 KiB (Content-Length or streamed/chunked) | 413 |
| Body not received within 5 s | 408 |
| Invalid JSON | 400 `invalid_json` |
| Not an object / extra keys / arrays / bulk lookups | 400 `invalid_request` |
| `discord_id` not a string matching `^[1-9]\d{16,19}$` | 400 `invalid_discord_id` |
| > `MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE` (default 600) per credential | 429 `rate_limited` + `Retry-After` |
| > 30 lookups/min for one `discord_id` | 429 `rate_limited` |
| > 32 lookups in flight (a timed-out lookup keeps its slot until it settles) | 429 `overloaded`, `Retry-After: 1` |
| Lookup > 3 s | 503 `lookup_timeout`, `Retry-After: 5` |
| Lookup throws | 503 `lookup_failed`, no internal detail |

Rate limiters are in memory with a bounded key table. When it's full, new keys
are refused rather than letting memory grow. `MEMBER_ACCESS_TRUST_PROXY=1`
takes the failed-auth IP from `X-Real-IP`, else the rightmost `X-Forwarded-For`
entry; otherwise the socket address is used. On an existing Express app, mount
before any body parser.

## Decision rules (pure function, first match wins)

Facts from the bot's existing helpers:
- `joiningCompleted`
- `membershipEnded`: cancelled/expired/restricted, never from an archived thread
- `suspended`
- `payment`, `terms`, `earlyAccess`, `identityVerification`: each is
  `satisfied` / `unsatisfied` / `not_required`, according to the member's own
  arrangement
- `winningApplicationId`, `applicationCount`
- every NDA record: `id`, `applicationId`, `signedName` as typed, `signedAt`,
  `voided`, `replacedById`

Customer decision:

1. `suspended` → `suspended`
2. `membershipEnded` → `membership_inactive`
3. payment unsatisfied → `payment_incomplete`
4. no valid NDA → `nda_missing`
5. joining not completed, or terms/earlyAccess/identityVerification
   unsatisfied → `onboarding_incomplete`
6. legal name unresolved → `identity_unresolved`
7. otherwise allowed, `signed_nda`

A newly published Terms version must not silently invalidate earlier
acceptances unless the bot already has an explicit business rule for that.

Overall precedence:

1. A suspended customer record → `suspended`, even for staff.
2. An allowed customer → allowed (`signed_nda`).
3. An active staff record → allowed with its name (`staff_record`). A missing
   or unusable name gives `identity_unresolved`.
4. An owner/admin/mentor role with no staff record → `identity_unresolved`.
   Only check roles when needed; a role alone never grants access.
5. Otherwise the customer denial reason, or `not_found` with no record.

## Legal name rules

- Only NDAs that are signed, not voided and not replaced count.
- With a winning application, use NDAs linked to it. Fall back to NDAs with no
  application only when `applicationCount <= 1`.
- No winning application and `applicationCount > 1` → `identity_unresolved`.
- No candidate NDAs → `nda_missing`.
- Normalise with NFKC, collapse whitespace and trim. Candidates that still
  differ case-insensitively → `identity_unresolved`. Otherwise use the most
  recently signed name.
- Usable name: 2–200 chars, contains a letter, no control characters, and not
  a placeholder (n/a, na, none, unknown, test, null, undefined, htnq, staff,
  admin, mentor, owner). Otherwise `identity_unresolved`.
- Never present a self-entered profile name as the legal name.

## Staff names

The platform decides who is staff from live Discord roles; the bot only
supplies the name. Add an owner-maintained staff table in the bot's existing DB
and migration style, roughly: `discord_id` text primary key, `legal_name` text
null, `active` boolean default true, `updated_by`, `updated_at`. Don't seed or
invent names. Optionally add an owner-only command to set or clear a staff name
that never echoes it into public channels or logs.

## Tests (all must pass)

Run these against a real HTTP server on an ephemeral port:

- **Allowed:** an entitled member → 200 allowed with `legal_name`,
  `signed_nda` and the exact key set.
- **Onboarding incomplete:** denied, with no `legal_name` key and the name
  nowhere in the body.
- **401:** missing token, wrong token, truncated token, different-case token,
  `Basic` scheme. The previous token still works during rotation.
- **400 for bad `discord_id` shapes:** number, too short, leading zero,
  letters, spaces, 21 digits, null, missing, extra key, `discord_ids` array,
  top-level array, JSON `null`.
- **Other request errors:** malformed JSON → 400; `text/plain` → 415;
  oversized body and oversized chunked body → 413; GET/PUT/DELETE/PATCH → 405.
- **NDA, payment and membership:** voided NDA → `nda_missing`; replaced-only
  NDA → `nda_missing`; suspended → `suspended`; membership ended →
  `membership_inactive`; payment unsatisfied → `payment_incomplete`; payment
  satisfied or `not_required` → allowed.
- **Archived enquiry thread:** still allowed.
- **Names:**
  - conflicting names → `identity_unresolved`, with neither name in the body
  - names differing only in case or whitespace → treated as the same name
  - a voided NDA with a conflicting name → ignored
  - the winning application's NDA → chosen
  - several applications with no winner → `identity_unresolved`
  - placeholder name → `identity_unresolved`
- **Staff:**
  - staff with a record → allowed, `staff_record`
  - record with no name or a placeholder name → `identity_unresolved`
  - staff role without a record → `identity_unresolved`
  - inactive record → ignored
  - suspended customer who also has a staff record → `suspended`
- **Unknown ID:** `not_found`.
- **Lookup failures:** DB throws → 503 `lookup_failed` with no internal text;
  slow lookup → 503 `lookup_timeout`.
- **Rate limits:**
  - per credential: 429 with `Retry-After`, recovering after the window
  - per `discord_id`: 429 without blocking other IDs
  - repeated bad tokens: 429 while the valid token still gets 200
  - concurrency cap: 429 `overloaded`
  - a burst of 50 concurrent requests within limits: all 200
- **Config:** a missing or short token is rejected; a token equal to any other
  env value is rejected without echoing the value; previous equal to current
  is rejected.
- **Logs:** captured logs never contain a legal name, either token, or DB
  error text.
- **Real data:** tests against the bot's real data model, e.g. a seeded fully
  joined member is allowed and a member mid-onboarding is denied.

## Deliverables

1. A draft PR in the bot repo with the endpoint, an adapter wired to the
   existing joining logic, the staff table migration, tests and docs.
2. The PR description must include:
   - A table mapping each fact (`joiningCompleted`, `membershipEnded`,
     `payment`, `terms`, `earlyAccess`, `identityVerification`, winning
     application, NDAs, `suspended`) to the exact existing function, table or
     column it comes from.
   - Every assumption or gap, listed as an open question.
   - The Railway variables for the bot's service:
     - `MEMBER_ACCESS_API_TOKEN`: required, e.g. `openssl rand -hex 32`,
       different for test and production
     - `MEMBER_ACCESS_API_TOKEN_PREVIOUS`: only during rotation
     - `MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE`: optional, default 600
     - `MEMBER_ACCESS_TRUST_PROXY=1`: optional
   - A note that the video platform's Supabase Edge Function secrets must be
     `MENTORSHIP_API_TOKEN` (the same value as `MEMBER_ACCESS_API_TOKEN`) and
     `MENTORSHIP_API_BASE_URL` (the bot's Railway HTTPS URL).
3. No deploys, no Railway setting changes, and no database URLs shared.
