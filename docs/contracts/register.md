# Shared integration contract register

Revision: F00.1. Authoritative repository: athamer736/htnqtradingchecklist, docs/contracts/register.md. The bot keeps this exact counterpart and the exact JSON fixtures in the same directory. Update both in the same logical feature; the paired check refuses diverging bytes. The existing app docs/bot-handoff-member-access-api.md remains the full v1 endpoint specification.

## Current member-access v1

POST /api/v1/member-access, schema_version 1, one decimal-string discord_id (17-20 digits, no leading zero), server-side bearer credential. Allowed responses contain only schema_version, discord_id, access, legal_name, identity_source, checked_at, recheck_after_seconds. Denials contain only schema_version, discord_id, access, reason_code, checked_at, recheck_after_seconds and never a legal name. No finance, email, signed document, role IDs, bulk lookup or caller-selected organisation is added. Successful denials are HTTP 200; authentication/validation/rate/outage errors remain HTTP errors, not membership decisions.

The JSON fixture covers both identity sources, all seven denial reasons, malformed requests and response rejection. Names/IDs are synthetic. Producer tests call the real bot HTTP handler with synthetic records. Consumer tests use the real strict app parser. The app paired command calls the actual bot handler from an explicitly supplied checkout over loopback and validates identical register/fixture bytes. No mock result is substituted for that handler in the paired run.

## Entitlement boundary

The bot computes its existing onboarding/identity/payment facts. Current app playback authorisation still uses live Discord roles; the bot is an optional legal-name source. A bot denial/outage removes that optional name, not an authorised viewer's role-based playback. Preserve the app's existing tests for this intentional distinction. Member-access v1 is not a new platform-wide financial entitlement API and grants no user-controlled identity. Names are ephemeral watermark data, not routine logs or local journals. TTL is at most 300 seconds on the app's allowed decision.

## Compatibility and releases

Keep v1 strict fields unchanged. Even additive wire fields are incompatible with the strict consumer unless coordinated/versioned; introduce a separately documented schema/endpoint version, fixtures and supported overlap before such a change. Do not reuse this response to return new platform-finance/student-profile fields. Fixtures must pass on each producer/consumer and in the paired check before a cross-repository release.

Record exact app/bot commits, contract revisions, changed migrations/functions, supported previous/new combinations, target IDs, configuration references, tested checks, owner approval evidence, rollout verification and rollback in the release manifest. The JSON template is a template, not permission or proof of a production version. Existing v1 needs no schema migration or provider configuration change in F00. Do not change immutable migration checksums or the bot's Stripe API pin for this work.

## Test invocation

Install locked dependencies with lifecycle scripts disabled. Run node scripts/f00/check.mjs in either repo. The bot defaults to in-process PGlite and reports two PostgreSQL-only skips; use --postgres only with the explicit local disposable profile described in docs/f00-delivery-controls.md. On the app, run node scripts/f00/check-paired.mjs <bot-checkout> for the real paired wire check. Node network guards and an environment allowlist are regression controls for trusted tests, not an OS sandbox for hostile code. No inherited operator credentials or production dotenv file enter the test child.
