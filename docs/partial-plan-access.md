# Partial payment-plan access

The automatic plan grants the dedicated Partial role and Level 1/2 roles before the bot grants full Students membership. The website must not require Students for these two lesson sections.

`DISCORD_ROLE_PARTIAL` defaults to the live Partial role `1562260164910907392`. Set a different ID for an isolated sandbox. Role IDs are public identifiers, not secrets. Never put the production bot token into the sandbox.

A partial member can list and play only published, ready Level 1/2 lessons covered by their early level roles, plus their descriptions. They cannot open Level 3, Further Studying, lectures, weekly recaps, cohort sections, recordings, uploads or management. A stray Level 3 role does not create early access. If Partial and Students coexist during a role handover, partial restrictions win until Partial is removed. Staff and existing full students retain their access.

The website reads live Discord roles on each list/playback request. It does not independently decide whether the £1,500 paid threshold or 14-day period is satisfied: the bot owns that decision and removes Partial before granting full Students access. The bot's member-access lookup remains a watermark-name lookup, as already agreed; it cannot bypass role checks.

## With editable tabs (2.0.3)

Mentorship pages are now admin-editable tabs (see `docs/video-platform.md`), but the partial fence is fixed in code (`supabase/functions/_shared/tabAccess.ts`) and ignores the tabs' role lists: a partial member can open only the built-in `level_1` / `level_2` tabs that their early Level roles cover, sees only published, ready lessons there, can never open an admin-created tab, and can never upload, manage or be a tab manager.

## Deployment and acceptance

1. Pass the complete PR test suite, TypeScript check and web build.
2. Deploy the Edge Functions with the shared policy changes, including list-content, issue-playback-token, level-descriptions, admin-members and verify-membership. A Pages deployment alone does not deploy Supabase functions.
3. Confirm the deployed Supabase DISCORD_BOT_TOKEN authenticates after the owner's token rotation, without revealing its value.
4. Deploy the matching website build. Keep the payment-plan launch disabled until the backend and frontend are verified.
5. In the isolated test guild, verify the user's real partial role can list/play Levels 1/2 but direct Level 3, lecture and recording requests fail without issuing a signed playback URL. Verify full access only after the bot's paid-plus-time gate and role transition; revoke/lose access on the next role check as appropriate.
6. Preserve historical payment/signature evidence. Do not grant Students early, expose old video forums, or reuse live payments as test cases.

The PR includes policy, navigation, signed playback and mixed-role transition tests. These do not replace the actual isolated-guild acceptance above.
