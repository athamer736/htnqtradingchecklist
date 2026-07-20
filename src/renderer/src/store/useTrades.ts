import { create } from 'zustand'
import type { TradeRecord } from '../types'
import { sanitizeName, sanitizeText } from '../../../shared/security'
import { requestSync } from '../sync/syncEngine'

// Normalizes user-entered text fields before a trade is persisted.
function cleanTrade(trade: TradeRecord): TradeRecord {
  return {
    ...trade,
    startSetup: sanitizeName(trade.startSetup),
    entryTimeframe: sanitizeName(trade.entryTimeframe),
    contract: sanitizeName(trade.contract),
    session: sanitizeName(trade.session),
    mmxm: sanitizeName(trade.mmxm),
    notes: sanitizeText(trade.notes)
  }
}

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
    const trades = await window.htnq.trades.save(cleanTrade(trade))
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
