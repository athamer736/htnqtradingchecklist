# HTNQ Trading Checklist

A minimal desktop tool for an ICT + Quarterly Theory day-trading strategy. Pick the setup you
spotted and the app generates the full ideal-setup confluence tree (with entries highlighted),
walks you through the next confluences to confirm, and lets you log and review trades.

## Tech stack

- Electron + electron-vite
- React + TypeScript + Vite
- Tailwind CSS
- @xyflow/react (React Flow) + dagre for the tree layout
- electron-store for local trade-journal persistence
- Zustand for state

## Development

```bash
npm install
npm run dev
```

## Cloud login & sync (optional)

The app can require a login and sync trades + data collection to a server, while
still working fully offline (local-first). This is powered by Supabase
(Postgres + Auth + Storage). If no Supabase keys are configured the app runs in
local-only mode with no login.

See [`supabase/README.md`](supabase/README.md) for the one-time setup: create the
project, run `supabase/schema.sql`, create user logins, and put the Project URL +
anon key in a root `.env` (see `.env.example`):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

## Mentorship content (online-only)

The **Mentorship** sidebar group (under Setup) is made of editable **tabs** plus Student Recordings (staff) or My
Recordings (students). Out of the box the tabs are Level 1-3, Further Studying, Lectures, Weekly Recaps & Outlooks
and the three batch tabs. Since 2.0.3 owners, admins and any role they name as a tab manager can add, rename,
reorder and delete tabs under Admin -> Tabs, and pick per tab which Discord roles may view, upload and manage it.
The Student role is required to view any tab. Access follows live Discord roles: mentors and admins upload directly from the app, and
every video plays with a personalised watermark (the viewer's Discord ID and current Discord username, plus their legal name when one is on file) after the mentorship
bot confirms access. Playback always needs an online check, even though the
rest of the app works offline.

- Architecture, roles, uploads, secrets, watermark limits: [`docs/video-platform.md`](docs/video-platform.md)
- Railway bot API handoff: [`docs/bot-handoff-member-access-api.md`](docs/bot-handoff-member-access-api.md)
- Launch checklist: [`docs/launch-checklist.md`](docs/launch-checklist.md)

```bash
npm test   # roles, permissions, validation, playback pipeline, signing (all mocked)
```

## Web app

The browser version is published to [app.htnq.org](https://app.htnq.org) by
[`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml). Setup and
DNS steps: [`docs/web-hosting.md`](docs/web-hosting.md).

```bash
npm run build:web   # single-file build in dist-web/
```

## Build a distributable .exe

```bash
npm run dist          # NSIS installer + portable .exe (in /dist)
npm run dist:portable # portable .exe only
```

Output appears in the `dist/` folder. Without a code-signing certificate, Windows SmartScreen will
show a "More info -> Run anyway" prompt on first launch for other users.

## macOS and other platforms

There is no macOS desktop build. Mac (and Linux, phone and tablet) users use the web app at
[app.htnq.org](https://app.htnq.org), which has the same tools, cloud sync and mentorship content.
See [`docs/web-hosting.md`](docs/web-hosting.md).

## Auto-update (installed app)

The installed (NSIS) build checks GitHub Releases on
[`athamer736/htnqtradingchecklist`](https://github.com/athamer736/htnqtradingchecklist) at launch,
downloads any newer version in the background, and prompts the user to restart to apply it. The
portable `.exe` and dev mode do not self-update.

### Publishing a new version

1. Bump `version` in [`package.json`](package.json).
2. Provide a GitHub token with `repo` scope so electron-builder can upload the release assets:
   - PowerShell (current session): `$env:GH_TOKEN = '<your_token>'`
   - Or persist it: `setx GH_TOKEN <your_token>` (open a new terminal afterwards).
3. Run the release build:

   ```bash
   npm run release
   ```

   This builds the app and uploads the installer `.exe`, its `.blockmap`, and `latest.yml` to a
   GitHub release tagged `v<version>`.
4. If the release is created as a draft, publish it on GitHub. Once published, installed apps pick
   up the update on their next launch.

Notes:

- `latest.yml` is what the updater reads to detect a new version, so it must be attached to the
  published release (electron-builder handles this during `npm run release`).
- Existing users must install the first auto-update-enabled build manually; every release after that
  updates automatically.
- Updates work even though builds are unsigned; SmartScreen warnings on first manual install are a
  separate, signing-related matter.
