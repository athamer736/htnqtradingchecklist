import { useEffect, useRef, type RefObject } from 'react'
import {
  attributesAllowed,
  colorAlpha,
  inlineStyleIntact,
  inspectWatermark,
  pickWatermarkLook,
  pickWatermarkPosition,
  watermarkFontPx,
  type Box,
  type LayerStyle,
  type TamperReason,
  type WatermarkLook,
  type WatermarkSnapshot
} from '../../../../shared/watermarkGuard'

export interface WatermarkIdentity {
  /** The viewer's Discord ID (always shown). */
  discordId: string
  /** The viewer's own legal name, when one is on file. */
  legalName?: string
  /** The viewer's current Discord username, when the server could read it. */
  username?: string
  sessionRef?: string
}

const CHECK_EVERY_MS = 1_000
// A failed check must still fail this long afterwards before it counts, so a passing layout
// change (fullscreen, resize) is never reported.
const CONFIRM_AFTER_MS = 600

function hostCss(look: WatermarkLook, pos: { x: number; y: number }): string {
  const rules: [string, string][] = [
    ['position', 'absolute'],
    ['left', `${pos.x}%`],
    ['top', `${pos.y}%`],
    ['z-index', String(look.zIndex)],
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['width', 'auto'],
    ['height', 'auto'],
    ['max-width', '85%'],
    ['margin', '0'],
    ['padding', '0'],
    ['pointer-events', 'none'],
    ['user-select', 'none'],
    ['filter', 'none'],
    ['clip-path', 'none'],
    ['mask', 'none'],
    ['mix-blend-mode', 'normal'],
    ['transform', `rotate(${look.rotateDeg}deg)`],
    ['transform-origin', '0 0'],
    ['transition', 'left 1s ease-in-out, top 1s ease-in-out']
  ]
  return rules.map(([k, v]) => `${k}:${v}!important`).join(';')
}

function boxCss(look: WatermarkLook, fontPx: number): string {
  const [r, g, b, a] = look.backing
  return [
    'all:initial',
    'display:block',
    'box-sizing:border-box',
    `background:rgba(${r},${g},${b},${a})`,
    `color:rgba(255,255,255,${look.textAlpha})`,
    `font-family:${look.fontFamily}`,
    `font-size:${fontPx}px`,
    `font-weight:${look.fontWeight}`,
    'line-height:1.35',
    `letter-spacing:${look.letterSpacingEm}em`,
    `padding:${look.padYEm}em ${look.padXEm}em`,
    `border-radius:${look.radiusPx}px`,
    'text-shadow:0 1px 2px rgba(0,0,0,0.6)',
    'overflow-wrap:anywhere',
    'white-space:normal',
    'user-select:none',
    '-webkit-user-select:none'
  ].join(';')
}

function nameLineOf(identity: WatermarkIdentity): string {
  return [identity.legalName, identity.username ? `@${identity.username}` : null].filter(Boolean).join(' | ')
}

function layerOf(el: Element): LayerStyle {
  const cs = getComputedStyle(el)
  const mask = cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image') || 'none'
  return {
    display: cs.display,
    visibility: cs.visibility,
    opacity: Number.parseFloat(cs.opacity),
    filter: cs.filter,
    clipPath: cs.clipPath,
    mask,
    mixBlendMode: cs.mixBlendMode,
    contentVisibility: cs.getPropertyValue('content-visibility') || 'visible',
    outlineStyle: cs.outlineStyle
  }
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Inline declarations as "value|priority", read back so browser formatting never matters. */
function inlineOf(el: HTMLElement): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < el.style.length; i++) {
    const name = el.style.item(i)
    out.set(name, `|${el.style.getPropertyPriority(name)}`)
  }
  return out
}

function hasPseudoContent(el: Element): boolean {
  return ['::before', '::after'].some((p) => {
    const content = getComputedStyle(el, p).content
    return content !== '' && content !== 'none' && content !== 'normal'
  })
}

function zOf(el: Element): number | null {
  const z = Number.parseInt(getComputedStyle(el).zIndex, 10)
  return Number.isFinite(z) ? z : null
}

/**
 * Moving personalised watermark showing the viewer's own legal name (when one is on file),
 * current Discord username and Discord ID, drawn over the player.
 *
 * Each open picks a new look and element name, and the text sits in a closed shadow root, so a
 * blocker rule written against one session does not match the next. While it is shown it is
 * checked every second and on every change; if it is removed, hidden, made transparent, shrunk,
 * moved or pushed behind the player, `onTamper` is called once and the checks stop.
 *
 * This is a deterrent and investigation aid, not DRM: code in the viewer's own browser can
 * always be changed, and it does not stop filming the screen.
 */
export default function WatermarkOverlay({
  identity,
  containerRef,
  frameRef,
  resetKey,
  onTamper
}: {
  identity: WatermarkIdentity
  /** The player box the watermark sits in. */
  containerRef: RefObject<HTMLElement>
  /** The video or document element inside that box, which the watermark must stay above. */
  frameRef: RefObject<HTMLElement>
  /** Change it when the video or document element is replaced, to start over with a new look. */
  resetKey: string | number
  onTamper: (reason: TamperReason) => void
}): null {
  const identityRef = useRef(identity)
  const onTamperRef = useRef(onTamper)
  const setTextRef = useRef<((identity: WatermarkIdentity) => void) | null>(null)

  useEffect(() => {
    onTamperRef.current = onTamper
  }, [onTamper])

  useEffect(() => {
    const container = containerRef.current
    const frame = frameRef.current
    if (!container || !frame) return

    const look = pickWatermarkLook()
    const host = document.createElement(look.tag)
    const root = host.attachShadow({ mode: 'closed' })
    const box = document.createElement('div')
    const nameEl = document.createElement('div')
    const idEl = document.createElement('div')
    const refEl = document.createElement('div')
    root.append(box)

    let pos = pickWatermarkPosition()
    let fontPx = watermarkFontPx(container.clientWidth, window.innerWidth)
    let expectedInline = new Map<string, string>()
    let expected = { name: '', id: '', ref: '' }
    let firstFailAt: number | null = null
    let stopped = false

    const writeHost = (): void => {
      host.setAttribute('style', hostCss(look, pos))
      expectedInline = inlineOf(host)
    }
    const writeBox = (): void => {
      box.setAttribute('style', boxCss(look, fontPx))
      nameEl.setAttribute('style', `all:unset;display:block;font-weight:${Math.min(800, look.fontWeight + 100)}`)
      idEl.setAttribute('style', 'all:unset;display:block')
      refEl.setAttribute(
        'style',
        'all:unset;display:block;margin-top:0.15em;font-size:0.8em;color:rgba(255,255,255,0.55)'
      )
    }
    const writeText = (id: WatermarkIdentity): void => {
      expected = {
        name: nameLineOf(id),
        id: `Discord ID ${id.discordId}`,
        ref: id.sessionRef ? `ref ${id.sessionRef}` : ''
      }
      nameEl.textContent = expected.name
      idEl.textContent = expected.id
      refEl.textContent = expected.ref
      const lines = look.idFirst ? [idEl, nameEl] : [nameEl, idEl]
      box.replaceChildren(...lines.filter((el) => el.textContent), ...(expected.ref ? [refEl] : []))
    }

    writeHost()
    writeBox()
    writeText(identityRef.current)
    if (look.insertFirst && frame.parentNode === container) container.insertBefore(host, frame)
    else container.appendChild(host)

    const textIntact = (): boolean =>
      box.parentNode === root &&
      idEl.parentNode === box &&
      idEl.textContent === expected.id &&
      (!expected.name || (nameEl.parentNode === box && nameEl.textContent === expected.name)) &&
      (!expected.ref || (refEl.parentNode === box && refEl.textContent === expected.ref))

    const snapshot = (): WatermarkSnapshot => ({
      hostAttached: host.isConnected && host.parentNode === container,
      frameAttached: frame.isConnected && frame.parentNode === container,
      attributesIntact:
        attributesAllowed(host.getAttributeNames()) && inlineStyleIntact(expectedInline, inlineOf(host)),
      hostPseudo: hasPseudoContent(host),
      textIntact: textIntact(),
      layers: [host, box, idEl, ...(expected.name ? [nameEl] : [])].map(layerOf),
      textColorAlpha: colorAlpha(getComputedStyle(idEl).color),
      fontSizePx: Number.parseFloat(getComputedStyle(idEl).fontSize),
      host: boxOf(host),
      container: boxOf(container),
      hostZ: zOf(host),
      expectedZ: look.zIndex,
      frameZ: zOf(frame)
    })

    const stop = (): void => {
      stopped = true
      window.clearInterval(checkTimer)
      window.clearInterval(moveTimer)
      observer.disconnect()
      resize.disconnect()
    }

    const evaluate = (): void => {
      if (stopped) return
      let reason: TamperReason | null
      try {
        reason = inspectWatermark(snapshot())
      } catch {
        reason = 'removed'
      }
      if (!reason) {
        firstFailAt = null
        return
      }
      const now = performance.now()
      if (firstFailAt === null) {
        firstFailAt = now
        window.setTimeout(evaluate, CONFIRM_AFTER_MS)
        return
      }
      if (now - firstFailAt < CONFIRM_AFTER_MS - 50) return
      stop()
      onTamperRef.current(reason)
    }

    let scheduled = false
    const soon = (): void => {
      if (scheduled || stopped) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        evaluate()
      })
    }

    const observer = new MutationObserver(soon)
    observer.observe(container, { childList: true })
    observer.observe(host, { attributes: true })
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })

    const resize = new ResizeObserver(() => {
      const next = watermarkFontPx(container.clientWidth, window.innerWidth)
      if (next !== fontPx) {
        fontPx = next
        writeBox()
      }
    })
    resize.observe(container)

    const checkTimer = window.setInterval(evaluate, CHECK_EVERY_MS)
    const moveTimer = window.setInterval(() => {
      pos = pickWatermarkPosition()
      writeHost()
    }, look.moveEveryMs)

    setTextRef.current = (id) => {
      if (!stopped) writeText(id)
    }

    return () => {
      stop()
      setTextRef.current = null
      host.remove()
    }
  }, [containerRef, frameRef, resetKey])

  useEffect(() => {
    identityRef.current = identity
    setTextRef.current?.(identity)
  }, [identity])

  return null
}
