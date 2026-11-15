# H4STH2 bot: `POST /api/v1/member-access`

Drop-in implementation of the member-access contract the HTNQ video platform
calls on every playback (see `docs/bot-handoff-member-access-api.md` on the
platform branch). It has no runtime dependencies (Node `http` and `crypto` only).

**This lives here because the bot repository wasn't available when it was
written.** It is not wired into the bot yet. To finish the integration, copy
`src/` and `tests/` into the bot and implement the records adapter described
below. Video playback fails closed until that's deployed.

## What's here

| File | Purpose |
| --- | --- |
| `src/contract.ts` | Wire types, `schema_version: 1`, Discord ID validation (strings only) |
| `src/decision.ts` | Pure access decision + deterministic legal-name resolution |
| `src/auth.ts` | Bearer parsing, constant-time credential match (current + previous token) |
| `src/rateLimit.ts` | Bounded in-memory fixed-window limiter |
| `src/handler.ts` | HTTP handler: method/path/auth/body checks, rate limits, load shedding, timeouts, sanitised logs |
| `src/config.ts` | Env loading; refuses weak tokens or tokens reused from any other env var |
| `src/index.ts` | `memberAccessHandlerFromEnv`, `startMemberAccessServer` |

## Wiring into the bot

1. Implement `MemberAccessRecords` with the bot's **existing** joining helpers:

   ```ts
   const records: MemberAccessRecords = {
     async getMemberFacts(discordId) {
       // Return null if the bot has no customer record for this ID.
       // Every field must come from the same helpers the joining flow uses.
     },
     async getStaffRecord(discordId) {
       // Row from the owner-maintained staff table, or null.
     },
     async hasStaffRole(discordId) {
       // Optional: true if the member holds owner/admin/mentor in the guild.
       // Only turns not_found into identity_unresolved; never grants access.
     }
   }
   ```

   | `MemberJoiningFacts` field | Must mean |
   | --- | --- |
   | `joiningCompleted` | Joining recorded as complete, or an active membership entitlement |
   | `membershipEnded` | Cancelled/expired/restricted. **Never** set from an archived enquiry thread |
   | `suspended` | Any suspension that ends access |
   | `payment` | The bot's agreement-aware check: paid under the member's *own* agreed price/plan. Don't compare against a fixed amount |
   | `terms` | Terms acceptance under the bot's existing rule. A new Terms version must not invalidate earlier acceptances unless there is an explicit business rule |
   | `earlyAccess`, `identityVerification` | `not_required` when the member's arrangement doesn't need them |
   | `winningApplicationId`, `applicationCount` | Which application governs the member; `null` with several applications means staff review |
   | `ndas` | **All** NDA records for the member, including voided/replaced ones, with `signed_name` as typed when signing |

2. Mount it, either on an existing Node HTTP/Express server **before** any body
   parser (the handler reads and size-limits the body itself):

   ```ts
   const memberAccess = memberAccessHandlerFromEnv(records)
   app.use(memberAccess) // Express: passes through other paths via next()
   ```

   or standalone if the bot doesn't serve HTTP yet (listens on Railway's `PORT`):

   ```ts
   startMemberAccessServer(records)
   ```

   `memberAccessHandlerFromEnv` throws at boot if the token is missing, shorter
   than 32 characters, or equal to any other env var's value.

3. Staff names: keep them in an owner-maintained table, for example:

   ```sql
   create table staff_identity (
     discord_id  text primary key,          -- snowflake as text
     legal_name  text,                      -- null until the owner records it
     active      boolean not null default true,
     updated_by  text not null,
     updated_at  timestamptz not null default now()
   );
   ```

## Decision rules

Checked in this order; the first match wins:

1. A suspended customer record gives `suspended`, even for staff.
2. An entitled customer gets `allowed` with `identity_source: "signed_nda"`.
3. An active staff record with a usable name gets `allowed` with
   `identity_source: "staff_record"`. Without a usable name the answer is
   `identity_unresolved`.
4. A staff role with no staff record gives `identity_unresolved`.
5. Otherwise the customer's denial reason applies (`membership_inactive`,
   `payment_incomplete`, `nda_missing`, `onboarding_incomplete`,
   `identity_unresolved`), or `not_found` if there's no record.

The legal name comes only from signed NDAs that are neither voided nor
replaced, linked to the winning application. Names differing only in case or
whitespace count as the same name, and the latest signing is used. Names that
really conflict, several applications with no winner, or placeholder names
all give `identity_unresolved`. Denied responses never include `legal_name`.

## Operational behaviour

| Condition | Response |
| --- | --- |
| Not `POST` | 405 (`Allow: POST`) |
| Missing/wrong bearer token | 401; after 10 failures/min from one IP, 429 (valid token is never locked out by this) |
| Not `application/json` | 415 |
| Body > 1 KiB (declared or streamed) | 413 |
| Bad JSON / extra fields / bulk lookups / bad `discord_id` | 400 |
| > `MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE` per credential (default 600) | 429 + `Retry-After` |
| > 30 lookups/min for one Discord ID | 429 |
| > 32 lookups in flight | 429 `overloaded` |
| Adapter slower than 3 s / throws | 503 (`lookup_timeout` / `lookup_failed`), no internal detail |

Logs are one JSON line per request with request id, status, access, reason
code, credential label (`current`/`previous`) and the last 4 digits of the
Discord ID. They never contain legal names, tokens, raw bodies or adapter
error messages.

## Environment variables (bot service on Railway)

| Variable | Required | Notes |
| --- | --- | --- |
| `MEMBER_ACCESS_API_TOKEN` | yes | Dedicated credential, e.g. `openssl rand -hex 32`. Use different values for test and production |
| `MEMBER_ACCESS_API_TOKEN_PREVIOUS` | no | Set to the old value while rotating, remove once the platform uses the new one |
| `MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE` | no | Per-credential limit, default 600 |
| `MEMBER_ACCESS_TRUST_PROXY` | no | `1` to rate-limit failed auth by `X-Real-IP`/`X-Forwarded-For` from Railway's proxy |

The platform's `MENTORSHIP_API_TOKEN` Supabase secret must equal the bot's
`MEMBER_ACCESS_API_TOKEN`.

## Tests

```bash
npm install
npm run typecheck
npm test
```
