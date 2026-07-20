import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Unforgeable marker that this API is the real Electron preload (not the web
  // shim in webShim.ts, which never sets this). Used by the renderer to tell the
  // desktop app apart from the browser build, since both expose window.htnq.
  isDesktop: true,
  trades: {
    list: () => ipcRenderer.invoke('trades:list'),
    save: (trade: unknown) => ipcRenderer.invoke('trades:save', trade),
    delete: (id: string) => ipcRenderer.invoke('trades:delete', id),
    clear: () => ipcRenderer.invoke('trades:clear')
  },
  data: {
    list: () => ipcRenderer.invoke('data:list'),
    saveSection: (s: unknown) => ipcRenderer.invoke('data:saveSection', s),
    saveColumn: (c: unknown) => ipcRenderer.invoke('data:saveColumn', c),
    reorderColumns: (ids: string[]) => ipcRenderer.invoke('data:reorderColumns', ids),
    saveTag: (t: unknown) => ipcRenderer.invoke('data:saveTag', t),
    saveEntry: (e: unknown) => ipcRenderer.invoke('data:saveEntry', e),
    deleteSection: (id: string) => ipcRenderer.invoke('data:deleteSection', id),
    deleteColumn: (id: string) => ipcRenderer.invoke('data:deleteColumn', id),
    deleteTag: (id: string) => ipcRenderer.invoke('data:deleteTag', id),
    deleteEntry: (id: string) => ipcRenderer.invoke('data:deleteEntry', id),
    reset: () => ipcRenderer.invoke('data:reset'),
    importData: (payload: unknown, mode: string) =>
      ipcRenderer.invoke('data:importData', payload, mode),
    exportFile: (bytes: Uint8Array, defaultName: string) =>
      ipcRenderer.invoke('data:exportFile', bytes, defaultName),
    importFile: () => ipcRenderer.invoke('data:importFile')
  },
  sync: {
    getMeta: () => ipcRenderer.invoke('sync:getMeta'),
    setCursor: (cursor: string) => ipcRenderer.invoke('sync:setCursor', cursor),
    setOwner: (owner: string) => ipcRenderer.invoke('sync:setOwner', owner),
    claimAll: () => ipcRenderer.invoke('sync:claimAll'),
    wipeForNewOwner: () => ipcRenderer.invoke('sync:wipeForNewOwner'),
    collectOutbox: () => ipcRenderer.invoke('sync:collectOutbox'),
    clearOutbox: (acks: unknown) => ipcRenderer.invoke('sync:clearOutbox', acks),
    applyRemote: (rows: unknown) => ipcRenderer.invoke('sync:applyRemote', rows)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  auth: {
    startDiscord: (authUrl: string) => ipcRenderer.invoke('auth:startDiscord', authUrl)
  },
  updates: {
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    subscribe: (cb: (status: unknown) => void) => {
      const listener = (_e: unknown, status: unknown): void => cb(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('htnq', api)

export type HtnqApi = typeof api
