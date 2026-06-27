# HTNQ Trading Checklist

A minimal desktop tool for an ICT + Quarterly Theory day-trading strategy. Pick the setup you
spotted and the app generates the full ideal-setup confluence tree (with entries highlighted),
walks you through the next confluences to confirm, and lets you log and review trades.

## Core idea

Reversion levels (RL) and FVGs are the same thing. Every FVG / RL is confirmed by **either**:

- an **SMT** (reversal): `FVG -> SMT -> TPD -> MMXM (new RL entry)`
- a **TPD** (continuation): `FVG -> TPD -> MMXM (new RL entry)`

Each new RL repeats the same logic one timeframe lower, down to an M1 RL entry.

The entire strategy is data-driven from a single file:
[`src/renderer/src/strategy/strategy.ts`](src/renderer/src/strategy/strategy.ts). Edit the
`REVERSAL` and `CONTINUATION` tables there to refine the strategy; the tree, guided panel and
reference tables all regenerate automatically.

## Tech stack

- Electron + electron-vite
- React + TypeScript + Vite
- Tailwind CSS
- @xyflow/react (React Flow) + dagre for the tree layout
- electron-store for local trade-journal persistence
- Zustand for state

## Development

```bash
npm install
npm run dev
```

## Build a distributable .exe

```bash
npm run dist          # NSIS installer + portable .exe (in /dist)
npm run dist:portable # portable .exe only
```

Output appears in the `dist/` folder. Without a code-signing certificate, Windows SmartScreen will
show a "More info -> Run anyway" prompt on first launch for other users.
