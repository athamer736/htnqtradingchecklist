/**
 * Tiny, safe formatter for video descriptions.
 *
 * Staff type plain text with a few markdown-style marks; the UI renders the
 * parsed tree as React elements (never as HTML), so nothing typed here can inject
 * markup, links, images or scripts. Anything not listed below is shown as-is.
 *
 *   blank line            new paragraph
 *   single new line       line break inside the paragraph
 *   # Heading             large heading     ## Heading   smaller heading
 *   - item / * item / • item   bullet list
 *   1. item / 1) item     numbered list
 *   **bold**   *italic*
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }

export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'h'; level: 1 | 2; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }

// No look-behind, so this also runs in older Safari builds of the web app.
const BOLD = /\*\*(\S(?:.*?\S)?)\*\*/
const ITALIC = /\*([^\s*](?:[^*]*?[^\s*])?)\*/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src
  while (rest.length > 0) {
    const b = BOLD.exec(rest)
    const i = ITALIC.exec(rest)
    // Take whichever mark starts first (bold wins a tie: it begins with `**`).
    const useBold = b && (!i || b.index <= i.index)
    const m = useBold ? b : i
    if (!m) {
      out.push({ t: 'text', v: rest })
      break
    }
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) })
    out.push({ t: useBold ? 'b' : 'i', c: parseInline(m[1]) })
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

const HEADING = /^(#{1,2})\s+(.+)$/
const BULLET = /^\s*(?:[-*•])\s+(.+)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.+)$/

export function parseRichText(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')

  let para: Inline[][] = []
  const flushPara = (): void => {
    if (para.length > 0) blocks.push({ t: 'p', lines: para })
    para = []
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') {
      flushPara()
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      flushPara()
      blocks.push({ t: 'h', level: h[1].length === 1 ? 1 : 2, c: parseInline(h[2]) })
      continue
    }
    const ul = BULLET.exec(line)
    const ol = ul ? null : NUMBERED.exec(line)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      const item = parseInline((ul ?? ol)![1])
      const last = blocks[blocks.length - 1]
      if (last && last.t === kind) last.items.push(item)
      else blocks.push({ t: kind, items: [item] })
      continue
    }
    para.push(parseInline(line.trim()))
  }
  flushPara()
  return blocks
}

function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : inlineText(n.c))).join('')
}

/** The description without any marks, collapsed to one line (for card previews). */
export function stripFormatting(src: string): string {
  return parseRichText(src)
    .flatMap((b) => {
      switch (b.t) {
        case 'p':
          return b.lines.map(inlineText)
        case 'h':
          return [inlineText(b.c)]
        default:
          return b.items.map(inlineText)
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
