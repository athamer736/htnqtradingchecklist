export interface TradeRecord {
  id: string
  createdAt: string
  startSetup: string
  entryTimeframe: string
  direction: 'long' | 'short'
  contract: string
  contracts: number | null
  entryPrice: number | null
  tpPoints: number | null
  slPoints: number | null
  dollarRisk: number | null
  dollarTp: number | null
  highsPoints: number | null
  lowsPoints: number | null
  tradedAt: string
  result: 'win' | 'loss' | 'be'
  rMultiple: number | null
  session: string
  mmxm?: string
  notes: string
  // Sync metadata (stamped by the local store on write).
  updatedAt?: string
  deletedAt?: string | null
}
