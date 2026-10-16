import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'

// electron-updater is CommonJS; destructure the default export so the named
// `autoUpdater` resolves correctly under ESM interop.
const { autoUpdater } = pkg

export type UpdateStatus =
  | { phase: 'available'; version: string }
  | { phase: 'progress'; percent: number; version: string }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

// Remember the latest status so a renderer that mounts after an event fired can
// still pick up the current state via update:getStatus (avoids a race).
let lastStatus: UpdateStatus | null = null

export function getUpdateStatus(): UpdateStatus | null {
  return lastStatus
}

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', status)
  }
}

// Checks GitHub Releases for a newer version. Once an update is detected it is
// downloaded automatically and the renderer is told to show a blocking overlay,
// then the app force-installs and restarts - the user cannot skip the update.
// Only runs for the installed (NSIS) build; dev mode and the portable .exe
// cannot self-update.
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  if (process.env.PORTABLE_EXECUTABLE_DIR) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    broadcast({ phase: 'available', version: info.version })
  })

  autoUpdater.on('download-progress', (p) => {
    const version = (lastStatus && 'version' in lastStatus && lastStatus.version) || ''
    broadcast({ phase: 'progress', percent: Math.round(p.percent), version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ phase: 'downloaded', version: info.version })
    // Force the update: quit and install without giving the user a choice. The
    // short delay lets the renderer paint the "installing" state first.
    setTimeout(() => autoUpdater.quitAndInstall(), 1200)
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-update]', err)
    // Surface the error so the renderer unblocks instead of trapping the user.
    broadcast({ phase: 'error', message: String((err && err.message) || err) })
  })

  autoUpdater.checkForUpdates().catch((e) => {
    console.error('[auto-update]', e)
    broadcast({ phase: 'error', message: String((e && e.message) || e) })
  })
}
