# Bot-side handoff: `POST /api/v1/member-access`

The HTNQ Trading Checklist video platform expects a **versioned HTTPS API** on
the H4STH2 Mentorship Discord bot (Railway).

**Status (2026-10-16):** implemented in the bot repository
(`athamer736/h4sth2-mentorship-bot`, draft PR #10, branch `member-access-api`,
commit `33c5b29`), built on the bot's pricing/onboarding PR #9. Not merged or
deployed. The bot repository is private and was not readable from the platform
agent, so the platform was matched to the contract as relayed by the owner (the
same shapes as below), not to the bot's source files. **End-to-end integration
is unverified** until an authorised sandbox test passes.

## How the platform validates responses

The platform (`supabase/functions/_shared/mentorshipApi.ts`) fails closed
("temporarily unavailable") on anything outside this contract:

- `schema_version` must be the number `1`; `discord_id` must equal the
  requested ID (a decimal string matching `^[1-9]\d{16,19}$`).
- `checked_at` (UTC, `Z` suffix) and integer `recheck_after_seconds` are
  required on **both** allowed and denied responses.
- Exact key sets: allowed has exactly the 7 documented keys; denied has
  exactly 6 and never `legal_name` or `identity_source`. Extra fields (for
  example an address or payment reference) are rejected.
- `identity_source` is `signed_nda` or `staff_record` (`manual_review` is no
  longer accepted). `staff_record` is only honoured if the viewer also holds a
  live owner/admin/mentor role.
- Names must pass the same usability rules as the bot (2-200 chars, a letter,
  no control/bidi characters, no placeholders).
- `recheck_after_seconds` is capped at 300 on the platform side.
- HTTP: 401/403 → misconfigured (no retry); 429 → unavailable, `Retry-After`
  passed to the client (no retry); 5xx/timeout/network → up to 2 retries;
  non-JSON content type, bodies over 16 KiB, redirects → unavailable.
- `MENTORSHIP_API_BASE_URL` must be a bare HTTPS origin; the platform appends
  `/api/v1/member-access`.

Do **not** give the video platform a Railway database URL. Do **not** reuse
Stripe, Discord, Supabase service-role, or Checkout credentials for this API.

## Endpoint

```
POST /api/v1/member-access
Authorization: Bearer <MENTORSHIP_API_TOKEN>
Content-Type: application/json
Cache-Control: no-store
```

### Request

```json
{ "discord_id": "123456789012345678" }
```

- Treat Discord IDs as **strings** forever (never JS numbers).
- Reject non-POST, oversized bodies, missing/invalid bearer tokens.
- Rate-limit per credential / IP. No bulk identity lookup.

### Allowed response

```json
{
  "schema_version": 1,
  "discord_id": "123456789012345678",
  "access": "allowed",
  "legal_name": "Example Customer",
  "identity_source": "signed_nda",
  "checked_at": "2026-10-08T12:00:00Z",
  "recheck_after_seconds": 300
}
```

### Denied response

```json
{
  "schema_version": 1,
  "discord_id": "123456789012345678",
  "access": "denied",
  "reason_code": "onboarding_incomplete"
}
```

Denied responses **must not** include `legal_name`.

Suggested `reason_code` values:

- `onboarding_incomplete`
- `nda_missing`
- `payment_incomplete`
- `membership_inactive`
- `suspended`
- `not_found`
- `identity_unresolved`

## Decision rules (reuse bot joining logic)

Derive `access` from actual bot records / shared internal helpers — do not
duplicate contradictory conditions. As applicable:

- Active membership entitlement or recorded completed joining
- Required payment received under the customer’s **actual agreement**
- Required NDA signed and not voided
- Required Terms acceptance (a newly published Terms version must **not**
  silently invalidate all earlier acceptances without an explicit business rule)
- Early-access confirmation or completed waiting period when required
- Identity verification when required for the payment arrangement
- No suspension / cancellation / restriction that ends access

**Important:** an archived enquiry thread is **not** evidence of cancelled
membership — successful joining intentionally archives the enquiry.

### Legal name

> **Update:** the platform no longer needs a legal name to play a video. The
> watermark is the viewer's Discord ID. The platform treats `denied` +
> `identity_unresolved` as "eligible, no name" and every other denial as a block,
> so keep returning `identity_unresolved` **only** after suspension, membership,
> payment, NDA and onboarding have all passed. A name is still returned when
> available, but it is only a backup identifier for investigations and for the
> Admin panel's audited lookup.

Resolve from the customer’s **valid signed record** (e.g. NDA `signed_name`
linked to the winning application). Do not claim a self-entered profile name is
identity-verified. Conflicting names, multiple applications, and replaced/voided
NDAs need deterministic handling or staff review (`identity_unresolved`).

Do **not** send addresses, phone numbers, payment references, document images,
or complete contracts to the video platform.

Existing customers must retain agreed prices and valid document history. Video
access must **not** hard-code “paid £1,500”.

### Staff (owner, admin, mentor)

Staff watch through the same playback check, so every playback, including staff
previews of private videos and 1:1 recordings, needs `access: "allowed"` with a
legal name (optional now: the watermark is the Discord ID). The platform decides **who is staff** from live
Discord roles; the bot only answers "may this Discord ID watch, and under what
name?". For staff who have no customer joining record, return:

```json
{
  "schema_version": 1,
  "discord_id": "123456789012345678",
  "access": "allowed",
  "legal_name": "Staff Member Name",
  "identity_source": "staff_record",
  "checked_at": "2026-10-16T12:00:00Z",
  "recheck_after_seconds": 300
}
```

Keep `staff_record` names in a bot-side staff table maintained by the owner.
Do not invent names, and do not allow everyone holding a Discord staff role
automatically; an unknown staff member should get
`{ "access": "denied", "reason_code": "identity_unresolved" }` until a name is
recorded.

Students only see their own 1:1 recordings; the platform enforces that. The bot
needs no recording-specific logic.

## Auth & ops

- Dedicated high-entropy, rotatable service credential
- Separate test vs production credentials and deployments
- Constant-time credential comparison where applicable
- Sanitised errors; no secrets, full legal names, raw bodies, or signed playback
  URLs in routine logs
- Timeouts + bounded retries on the **caller** side (platform); bot should shed
  load with 429 rather than hanging
- CORS is irrelevant as a security control — this is trusted-server-only

## Platform configuration (after bot deploy)

In **Supabase → Edge Function secrets** (not `.env` with `VITE_`):

```
MENTORSHIP_API_BASE_URL=https://<your-railway-service>
MENTORSHIP_API_TOKEN=<production credential>
```

Then redeploy the `issue-playback-token` Edge Function (with deployment
authorisation).

## Tests the bot should add

- Valid token + entitled member → allowed + legal_name
- Valid token + incomplete onboarding → denied, no legal_name
- Wrong/missing token → 401
- Invalid discord_id shape → 400
- Voided NDA / suspended → denied
- Name conflict → `identity_unresolved`
- Staff with a staff record → allowed, `identity_source: "staff_record"`
- Staff without a staff record → denied `identity_unresolved`
- Load/rate-limit behaviour

## Platform test-only mock

`tests/mocks/mentorshipAccessMock.ts` implements this contract for local tests.
It must never be used as a production substitute. Production playback **fails
closed** when the real endpoint is missing or misconfigured.
