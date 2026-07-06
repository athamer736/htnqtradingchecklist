import { contextBridge, ipcRenderer } from 'electron'

const api = {
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
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
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
