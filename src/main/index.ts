import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initDb, listTrades, saveTrade, deleteTrade, type TradeRecord } from './db'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'HTNQ Trading Checklist',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

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

ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    return shell.openExternal(url)
  }
  return undefined
})

app.whenReady().then(() => {
  initDb()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
