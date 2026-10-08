# Launch checklist (mentorship videos)

## Implemented locally (this branch)

- [x] Video catalogue schema + RLS
- [x] `member_levels`, `video_staff_access`, `playback_audit`
- [x] `verify-membership` role sync (atomic replace / fail closed for video)
- [x] `list-videos` Edge Function
- [x] `issue-playback-token` Edge Function (Discord + Railway + Bunny embed)
- [x] Typed Railway client + contract tests + test-only mock
- [x] Videos UI, watermark, custom fullscreen shell
- [x] Electron content-protection hook (best-effort)
- [x] Docs + bot handoff

## Tested locally

- [x] Automated Node tests (`npm test`) for contract, Bunny signing, role mapping
- [ ] Real Supabase Edge Function deploy
- [ ] Real Railway endpoint
- [ ] Real Bunny library with token auth enabled
- [ ] Two-account sandbox watermark / denial checks
- [ ] macOS / mobile / DRM (not claimed)

## Configure in the cloud (owner)

### Supabase SQL

1. Run `supabase/migrations/20261008_video_platform.sql` (or full `schema.sql`).
2. Insert catalogue rows into `videos` (`bunny_video_id`, `level`, `published`, …).
3. For email/password staff viewers only:
   ```sql
   insert into public.video_staff_access (user_id, label, levels)
   values ('<auth-user-uuid>', 'HTNQ Staff', '{1,2,3}');
   ```

### Supabase secrets

```
supabase secrets set \
  DISCORD_BOT_TOKEN=… \
  DISCORD_GUILD_ID=… \
  DISCORD_ROLE_LEVEL_1=… \
  DISCORD_ROLE_LEVEL_2=… \
  DISCORD_ROLE_LEVEL_3=… \
  MENTORSHIP_API_BASE_URL=https://… \
  MENTORSHIP_API_TOKEN=… \
  BUNNY_STREAM_LIBRARY_ID=… \
  BUNNY_STREAM_TOKEN_KEY=…
```

Do not paste secrets into chat. Enter them in the Supabase secret store / CLI.

### Deploy functions (requires explicit deployment authorisation)

```
supabase functions deploy verify-membership
supabase functions deploy list-videos
supabase functions deploy issue-playback-token
```

### Bunny

1. Enable **Embed view token authentication** on the library.
2. Use the **Token authentication key** (not the library API key) as `BUNNY_STREAM_TOKEN_KEY`.
3. Prefer blocking hotlinking / unsigned embeds.

### Railway bot

1. Implement `POST /api/v1/member-access` per `docs/bot-handoff-member-access-api.md`.
2. Issue dedicated prod/test credentials.
3. Point `MENTORSHIP_API_BASE_URL` / `MENTORSHIP_API_TOKEN` at production.

## Verified end to end

Not yet — blocked on bot API + cloud secrets + function deploy + Bunny library.
