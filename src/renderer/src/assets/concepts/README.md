# Concept cover images

Drop cover screenshots for the Learn section here, then wire each one up in
[`../../content/concepts.ts`](../../content/concepts.ts):

1. Add the file to this folder (keep it compressed - the web build inlines
   assets into a single HTML file, so large images bloat `dist-web/index.html`).
2. Import it at the top of `concepts.ts`, e.g. `import fvgCover from '../assets/concepts/fvgs.png'`
3. Set `cover: fvgCover` on the matching concept.

Suggested filenames (match the concept `id`):

- `fvgs.png`
- `liquidity.png`
- `candlesticks.png`
- `cisd.png`
- `mmxm.png`
- `smts.png`
- `tpds.png`
- `ssmts.png`
- `points-theory.png`

Concepts without a `cover` render a themed placeholder automatically, so this is
optional and can be filled in over time.
