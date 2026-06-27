import { smtPathReference, tpdPathReference, type ReferenceRow } from '../strategy/engine'

function Table({ rows, accent }: { rows: ReferenceRow[]; accent: string }): JSX.Element {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3 font-medium">FVG / RL</th>
            <th className="px-4 py-3 font-medium">Confirmation</th>
            <th className="px-4 py-3 font-medium">Chain</th>
            <th className="px-4 py-3 font-medium">Entry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.fvg} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-3 font-medium text-slate-100">{r.fvg}</td>
              <td className="px-4 py-3">
                <span className="chip" style={{ color: accent, backgroundColor: `${accent}1a` }}>
                  {r.confirmation}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-300">{r.chain}</td>
              <td className="px-4 py-3">
                <span className="chip bg-slate-200 text-slate-900">{r.entry}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ReferenceView(): JSX.Element {
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <header className="mb-5">
        <h1 className="text-base font-semibold text-slate-100">Confluence reference</h1>
        <p className="text-xs text-muted">
          Every FVG / RL is confirmed by either an SMT or a TPD. Reversion levels and FVGs are the
          same thing.
        </p>
      </header>

      <section className="mb-7">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-teal" />
          <h2 className="text-sm font-semibold text-slate-200">Confirmed by SMT (FVG -&gt; SMT)</h2>
        </div>
        <Table rows={smtPathReference()} accent="#14b8a6" />
      </section>

      <section className="mb-7">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <h2 className="text-sm font-semibold text-slate-200">Confirmed by TPD (FVG -&gt; TPD)</h2>
        </div>
        <Table rows={tpdPathReference()} accent="#3b82f6" />
      </section>

      <p className="text-xs leading-relaxed text-muted/80">
        When confirmed by an SMT, the SMT resolves into a TPD which forms an MMXM (the new RL entry).
        When confirmed by a TPD, the TPD directly forms an MMXM (the new RL entry). Each entry RL
        repeats the same logic one timeframe lower until M1.
      </p>
    </div>
  )
}
