/// <reference types="vite/client" />

import type { TradeRecord } from './types'

interface HtnqApi {
  trades: {
    list: () => Promise<TradeRecord[]>
    save: (trade: TradeRecord) => Promise<TradeRecord[]>
    delete: (id: string) => Promise<TradeRecord[]>
  }
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    htnq: HtnqApi
  }
}

export {}
