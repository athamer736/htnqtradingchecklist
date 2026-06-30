import { app, dialog, BrowserWindow } from 'electron'
import pkg from 'electron-updater'

// electron-updater is CommonJS; destructure the default export so the named
// `autoUpdater` resolves correctly under ESM interop.
const { autoUpdater } = pkg

// Checks GitHub Releases for a newer version, downloads it in the background,
// and prompts the user to restart once it's ready. Only runs for the installed
// (NSIS) build - dev mode and the portable .exe cannot self-update.
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  if (process.env.PORTABLE_EXECUTABLE_DIR) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', async (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    const opts = {
      type: 'info' as const,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `HTNQ Trading Checklist ${info.version} is ready`,
      detail: 'Restart the app to finish updating.'
    }
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    if (response === 0) autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err) => console.error('[auto-update]', err))

  autoUpdater.checkForUpdates().catch((e) => console.error('[auto-update]', e))
}
