import { contextBridge, ipcRenderer } from 'electron'

const api = {
  trades: {
    list: () => ipcRenderer.invoke('trades:list'),
    save: (trade: unknown) => ipcRenderer.invoke('trades:save', trade),
    delete: (id: string) => ipcRenderer.invoke('trades:delete', id)
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('htnq', api)

export type HtnqApi = typeof api
