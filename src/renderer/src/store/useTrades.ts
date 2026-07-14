import { create } from 'zustand'
import type { TradeRecord } from '../types'
import { requestSync } from '../sync/syncEngine'

interface TradesState {
  trades: TradeRecord[]
  loaded: boolean
  load: () => Promise<void>
  save: (trade: TradeRecord) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export const useTrades = create<TradesState>((set) => ({
  trades: [],
  loaded: false,
  load: async () => {
    const trades = await window.htnq.trades.list()
    set({ trades, loaded: true })
  },
  save: async (trade) => {
    const trades = await window.htnq.trades.save(trade)
    set({ trades })
    requestSync()
  },
  remove: async (id) => {
    const trades = await window.htnq.trades.delete(id)
    set({ trades })
    requestSync()
  },
  clear: async () => {
    const trades = await window.htnq.trades.clear()
    set({ trades })
    requestSync()
  }
}))
