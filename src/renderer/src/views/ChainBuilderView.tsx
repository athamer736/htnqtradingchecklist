import ChainBuilderPanel from '../components/ChainBuilderPanel'

export interface ChainSeed {
  name: string
  labels: string[]
  nonce: number
}

// Your own private setup chains: any steps, in any order, as many as you like.
// Saved on this device and synced to your account only; nobody else can see them.
export default function ChainBuilderView({ seed }: { seed: ChainSeed | null }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <h1 className="text-base font-semibold text-slate-100">Setup Chain Builder</h1>
        <p className="text-xs text-muted">
          Build your own setup chains. Private to you, and synced across your devices.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <ChainBuilderPanel seed={seed} />
      </div>
    </div>
  )
}
