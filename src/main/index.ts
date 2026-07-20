import { app, shell, dialog, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { createServer, type Server } from 'http'
import icon from '../../resources/icon.png?asset'
import { initAutoUpdate, getUpdateStatus } from './updater'
import {
  initDb,
  listTrades,
  saveTrade,
  deleteTrade,
  clearTrades,
  listData,
  saveSection,
  saveColumn,
  reorderColumns,
  saveTag,
  saveEntry,
  deleteSection,
  deleteColumn,
  deleteTag,
  deleteEntry,
  resetData,
  importData,
  getSyncMeta,
  setSyncCursor,
  setSyncOwner,
  claimAllForSync,
  wipeAllForNewOwner,
  collectOutbox,
  clearOutbox,
  applyRemote,
  type TradeRecord
} from './db'
import {
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSection,
  type DataTag,
  type ImportMode
} from '../shared/dataCollection'
import type { SyncAck, SyncRow } from '../shared/sync'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: `HTNQ Trading Checklist Version ${app.getVersion()} Release`,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Keep our versioned title instead of the renderer's document <title>.
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('trades:list', () => listTrades())

ipcMain.handle('trades:save', (_e, trade: TradeRecord) => saveTrade(trade))

ipcMain.handle('trades:delete', (_e, id: string) => deleteTrade(id))

ipcMain.handle('trades:clear', () => clearTrades())

ipcMain.handle('data:list', () => listData())
ipcMain.handle('data:saveSection', (_e, s: DataSection) => saveSection(s))
ipcMain.handle('data:saveColumn', (_e, c: DataColumn) => saveColumn(c))
ipcMain.handle('data:reorderColumns', (_e, ids: string[]) => reorderColumns(ids))
ipcMain.handle('data:saveTag', (_e, t: DataTag) => saveTag(t))
ipcMain.handle('data:saveEntry', (_e, en: DataEntry) => saveEntry(en))
ipcMain.handle('data:deleteSection', (_e, id: string) => deleteSection(id))
ipcMain.handle('data:deleteColumn', (_e, id: string) => deleteColumn(id))
ipcMain.handle('data:deleteTag', (_e, id: string) => deleteTag(id))
ipcMain.handle('data:deleteEntry', (_e, id: string) => deleteEntry(id))
ipcMain.handle('data:reset', () => resetData())
ipcMain.handle('data:importData', (_e, payload: DataExport, mode: ImportMode) =>
  importData(payload, mode)
)

ipcMain.handle('data:exportFile', async (e, bytes: Uint8Array, defaultName: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = {
    title: 'Export Data Collection',
    defaultPath: defaultName,
    filters: [{ name: 'HTNQ export', extensions: ['zip'] }]
  }
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, opts)
    : await dialog.showSaveDialog(opts)
  if (canceled || !filePath) return { saved: false }
  await writeFile(filePath, Buffer.from(bytes))
  return { saved: true }
})

ipcMain.handle('data:importFile', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = {
    title: 'Import Data Collection',
    properties: ['openFile' as const],
    filters: [{ name: 'HTNQ export', extensions: ['zip', 'json'] }]
  }
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (canceled || filePaths.length === 0) return { ok: false, reason: 'cancel' }
  try {
    const buf = await readFile(filePaths[0])
    // Return a plain ArrayBuffer slice so it survives structured clone over IPC.
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return { ok: true, bytes: arrayBuffer }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
})

ipcMain.handle('sync:getMeta', () => getSyncMeta())
ipcMain.handle('sync:setCursor', (_e, cursor: string) => setSyncCursor(cursor))
ipcMain.handle('sync:setOwner', (_e, owner: string) => setSyncOwner(owner))
ipcMain.handle('sync:claimAll', () => claimAllForSync())
ipcMain.handle('sync:wipeForNewOwner', () => wipeAllForNewOwner())
ipcMain.handle('sync:collectOutbox', () => collectOutbox())
ipcMain.handle('sync:clearOutbox', (_e, acks: SyncAck[]) => clearOutbox(acks))
ipcMain.handle('sync:applyRemote', (_e, rows: SyncRow[]) => applyRemote(rows))

ipcMain.handle('update:getStatus', () => getUpdateStatus())

ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    return shell.openExternal(url)
  }
  return undefined
})

// --- Discord OAuth loopback capture -----------------------------------------
// Desktop can't receive a browser redirect at a file:// URL, so we run a
// one-shot localhost server on a fixed port, open the Supabase authorize URL in
// the system browser, and capture the ?code=... it redirects back with. The
// renderer then exchanges that code for a session (PKCE verifier lives there).
const OAUTH_LOOPBACK_PORT = 53123
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000
let authServer: Server | null = null

const CLOSE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>HTNQ</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e2e8f0;display:flex;height:100vh;margin:0;align-items:center;justify-content:center}div{text-align:center}</style>
</head><body><div><h2>Signed in to HTNQ</h2><p>You can close this window and return to the app.</p></div></body></html>`

ipcMain.handle('auth:startDiscord', (_e, authUrl: string): Promise<{ code?: string; error?: string }> => {
  return new Promise((resolve) => {
    if (typeof authUrl !== 'string' || !/^https:\/\//.test(authUrl)) {
      resolve({ error: 'Invalid authorize URL' })
      return
    }

    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      if (authServer) {
        authServer.close()
        authServer = null
      }
    }
    const finish = (result: { code?: string; error?: string }): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    // Tear down any server left over from an abandoned attempt.
    if (authServer) {
      authServer.close()
      authServer = null
    }

    authServer = createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', `http://127.0.0.1:${OAUTH_LOOPBACK_PORT}`)
      const code = parsed.searchParams.get('code')
      const err = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error')
      if (!code && !err) {
        // Ignore incidental requests (e.g. favicon) while we wait.
        res.statusCode = 204
        res.end()
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(CLOSE_PAGE)
      finish(code ? { code } : { error: err ?? 'Discord sign-in failed' })
    })

    authServer.on('error', (e) => finish({ error: `Loopback server error: ${e.message}` }))

    authServer.listen(OAUTH_LOOPBACK_PORT, '127.0.0.1', () => {
      void shell.openExternal(authUrl)
      timer = setTimeout(() => finish({ error: 'Timed out waiting for Discord sign-in' }), OAUTH_TIMEOUT_MS)
    })
  })
})

app.whenReady().then(() => {
  // Match the NSIS shortcut's AppUserModelID (= appId) so the installed app's
  // taskbar entry uses the shortcut/app icon instead of the default Electron one.
  if (process.platform === 'win32') app.setAppUserModelId('com.htnq.tradingchecklist')

  initDb()
  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
