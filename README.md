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

## Build a distributable .exe

```bash
npm run dist          # NSIS installer + portable .exe (in /dist)
npm run dist:portable # portable .exe only
```

Output appears in the `dist/` folder. Without a code-signing certificate, Windows SmartScreen will
show a "More info -> Run anyway" prompt on first launch for other users.

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
