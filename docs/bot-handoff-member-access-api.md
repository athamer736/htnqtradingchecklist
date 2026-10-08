# Bot-side handoff: `POST /api/v1/member-access`

The HTNQ Trading Checklist video platform expects a **versioned HTTPS API** on
the H4STH2 Mentorship Discord bot (Railway). This endpoint did **not** exist in
the platform checkout, and the bot repository was **not available** in this
environment (`athamer736/h4sth2-mentorship-bot` returned 404 to the agent token).
**End-to-end integration remains incomplete** until the bot implements and
deploys this contract.

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

Resolve from the customer’s **valid signed record** (e.g. NDA `signed_name`
linked to the winning application). Do not claim a self-entered profile name is
identity-verified. Conflicting names, multiple applications, and replaced/voided
NDAs need deterministic handling or staff review (`identity_unresolved`).

Do **not** send addresses, phone numbers, payment references, document images,
or complete contracts to the video platform.

Existing customers must retain agreed prices and valid document history. Video
access must **not** hard-code “paid £1,500”.

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

Redeploy Edge Functions: `issue-playback-token` (and keep `verify-membership`).

## Tests the bot should add

- Valid token + entitled member → allowed + legal_name
- Valid token + incomplete onboarding → denied, no legal_name
- Wrong/missing token → 401
- Invalid discord_id shape → 400
- Voided NDA / suspended → denied
- Name conflict → `identity_unresolved` or staff path
- Load/rate-limit behaviour

## Platform test-only mock

`tests/mocks/mentorshipAccessMock.ts` implements this contract for local tests.
It must never be used as a production substitute. Production playback **fails
closed** when the real endpoint is missing or misconfigured.
