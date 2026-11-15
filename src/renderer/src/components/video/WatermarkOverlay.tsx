import { useEffect, useRef, type RefObject } from 'react'
import {
  FLASH_VISIBLE_MS,
  attributesAllowed,
  colorAlpha,
  flashFontPx,
  inlineStyleIntact,
  inspectTiles,
  inspectWatermark,
  nextFlashDelayMs,
  pickTileLook,
  pickWatermarkLook,
  pickWatermarkPosition,
  randomTagName,
  watermarkFontPx,
  type Box,
  type LayerStyle,
  type TamperReason,
  type TileLook,
  type TileSnapshot,
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
// The flash is checked twice while it is up; both checks must fail before it counts.
const FLASH_CHECKS_MS = [120, 480]

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

function flashHostCss(zIndex: number): string {
  const rules: [string, string][] = [
    ['position', 'absolute'],
    ['inset', '0'],
    ['z-index', String(zIndex)],
    ['display', 'flex'],
    ['align-items', 'center'],
    ['justify-content', 'center'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['margin', '0'],
    ['padding', '0'],
    ['background', 'rgba(0,0,0,0.35)'],
    ['pointer-events', 'none'],
    ['user-select', 'none'],
    ['filter', 'none'],
    ['clip-path', 'none'],
    ['mask', 'none'],
    ['mix-blend-mode', 'normal'],
    ['transform', 'none']
  ]
  return rules.map(([k, v]) => `${k}:${v}!important`).join(';')
}

function flashBoxCss(fontFamily: string, fontPx: number): string {
  return [
    'all:initial',
    'display:block',
    'box-sizing:border-box',
    'max-width:90%',
    'background:rgba(0,0,0,0.6)',
    'color:rgba(255,255,255,0.95)',
    `font-family:${fontFamily}`,
    `font-size:${fontPx}px`,
    'font-weight:700',
    'line-height:1.3',
    'text-align:center',
    'padding:0.5em 0.9em',
    'border-radius:8px',
    'text-shadow:0 2px 4px rgba(0,0,0,0.7)',
    'overflow-wrap:anywhere',
    'user-select:none',
    '-webkit-user-select:none'
  ].join(';')
}

function tileHostCss(zIndex: number): string {
  const rules: [string, string][] = [
    ['position', 'absolute'],
    ['inset', '0'],
    ['z-index', String(zIndex)],
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['overflow', 'hidden'],
    ['margin', '0'],
    ['padding', '0'],
    ['pointer-events', 'none'],
    ['user-select', 'none'],
    ['filter', 'none'],
    ['clip-path', 'none'],
    ['mask', 'none'],
    ['mix-blend-mode', 'normal'],
    ['transform', 'none']
  ]
  return rules.map(([k, v]) => `${k}:${v}!important`).join(';')
}

/** One repeat of the ID pattern as a PNG data URL, or null when the page can't draw. */
function drawTile(lines: string[], t: TileLook, fontFamily: string): string | null {
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(t.tileW * scale)
  canvas.height = Math.round(t.tileH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.translate(t.tileW / 2, t.tileH / 2)
  ctx.rotate((t.angleDeg * Math.PI) / 180)
  ctx.font = `600 ${t.fontPx}px ${fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * t.fontPx * 1.35
    ctx.fillStyle = `rgba(0,0,0,${Math.round(t.alpha * 80) / 100})`
    ctx.fillText(line, 1, y + 1)
    ctx.fillStyle = `rgba(255,255,255,${t.alpha})`
    ctx.fillText(line, 0, y)
  })
  return canvas.toDataURL('image/png')
}

function tileLinesOf(identity: WatermarkIdentity): string[] {
  return [
    identity.username ? `@${identity.username}` : '',
    `ID ${identity.discordId}`,
    identity.sessionRef ? `ref ${identity.sessionRef}` : ''
  ].filter(Boolean)
}

function patternCss(image: string, t: TileLook): string {
  return [
    'all:initial',
    'position:absolute',
    'inset:0',
    'display:block',
    'pointer-events:none',
    `background-image:url("${image}")`,
    'background-repeat:repeat',
    `background-size:${t.tileW}px ${t.tileH}px`,
    `background-position:${t.offsetX}px ${t.offsetY}px`
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
 * With `flash` (videos), the viewer's details also flash large across the whole player for under
 * a second at random moments, so a screen recording or a cropped clip still shows who it was. The
 * flash is checked the same way while it is up. With `tiles` (videos), a faint pattern of the
 * viewer's ID and the session ref covers the whole picture all the time, so no crop is free of it;
 * it is checked with the watermark.
 *
 * This is a deterrent and investigation aid, not DRM: code in the viewer's own browser can
 * always be changed, and it does not stop filming the screen.
 */
export default function WatermarkOverlay({
  identity,
  containerRef,
  frameRef,
  resetKey,
  flash = false,
  tiles = false,
  onTamper
}: {
  identity: WatermarkIdentity
  /** The player box the watermark sits in. */
  containerRef: RefObject<HTMLElement>
  /** The video or document element inside that box, which the watermark must stay above. */
  frameRef: RefObject<HTMLElement>
  /** Change it when the video or document element is replaced, to start over with a new look. */
  resetKey: string | number
  /** Briefly flash the viewer's details across the whole player now and then (videos). */
  flash?: boolean
  /** Repeat the viewer's ID faintly across the whole picture (videos). */
  tiles?: boolean
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

    // The faint ID pattern across the whole picture (videos). Skipped if the page can't draw it.
    const tileLook = pickTileLook()
    const pattern = document.createElement('div')
    let expectedPattern: string | null = null
    let tileHost: HTMLElement | null = null
    let tileRoot: ShadowRoot | null = null
    let tileInline = new Map<string, string>()
    const writePattern = (id: WatermarkIdentity): boolean => {
      const image = drawTile(tileLinesOf(id), tileLook, look.fontFamily)
      if (!image) return false
      expectedPattern = patternCss(image, tileLook)
      pattern.setAttribute('style', expectedPattern)
      return true
    }
    if (tiles && writePattern(identityRef.current)) {
      tileHost = document.createElement(randomTagName())
      tileRoot = tileHost.attachShadow({ mode: 'closed' })
      tileRoot.append(pattern)
      tileHost.setAttribute('style', tileHostCss(look.zIndex))
      tileInline = inlineOf(tileHost)
      // Same layer as the moving watermark but earlier in the page, so the watermark stays on top.
      container.insertBefore(tileHost, host)
    }

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

    const tileSnapshot = (t: HTMLElement, r: ShadowRoot): TileSnapshot => ({
      hostAttached: t.isConnected && t.parentNode === container,
      frameAttached: frame.isConnected && frame.parentNode === container,
      attributesIntact: attributesAllowed(t.getAttributeNames()) && inlineStyleIntact(tileInline, inlineOf(t)),
      hostPseudo: hasPseudoContent(t),
      patternIntact: pattern.parentNode === r && pattern.getAttribute('style') === expectedPattern,
      layers: [t, pattern].map(layerOf),
      host: boxOf(t),
      container: boxOf(container),
      hostZ: zOf(t),
      expectedZ: look.zIndex,
      frameZ: zOf(frame)
    })

    const flashTimers = new Set<number>()
    let flashHost: HTMLElement | null = null

    const stop = (): void => {
      stopped = true
      window.clearInterval(checkTimer)
      window.clearInterval(moveTimer)
      for (const t of flashTimers) window.clearTimeout(t)
      flashTimers.clear()
      flashHost?.remove()
      flashHost = null
      observer.disconnect()
      resize.disconnect()
    }

    const later = (fn: () => void, ms: number): void => {
      const t = window.setTimeout(() => {
        flashTimers.delete(t)
        fn()
      }, ms)
      flashTimers.add(t)
    }

    const showFlash = (): void => {
      if (stopped) return
      const id = identityRef.current
      const fHost = document.createElement(randomTagName())
      const fRoot = fHost.attachShadow({ mode: 'closed' })
      const fBox = document.createElement('div')
      const fId = document.createElement('div')
      const idText = `Discord ID ${id.discordId}`
      fId.textContent = idText
      fId.setAttribute('style', 'all:unset;display:block')
      const lines = [nameLineOf(id), id.sessionRef ? `ref ${id.sessionRef}` : '']
      const [nameEl, refEl] = lines.map((text) => {
        const el = document.createElement('div')
        el.textContent = text
        el.setAttribute('style', 'all:unset;display:block')
        return el
      })
      refEl.setAttribute('style', 'all:unset;display:block;font-size:0.6em;color:rgba(255,255,255,0.75)')
      fBox.setAttribute('style', flashBoxCss(look.fontFamily, flashFontPx(container.clientWidth)))
      fBox.replaceChildren(...[nameEl, fId, refEl].filter((el) => el.textContent))
      fRoot.append(fBox)
      fHost.setAttribute('style', flashHostCss(look.zIndex))
      const fInline = inlineOf(fHost)
      container.appendChild(fHost)
      flashHost = fHost

      const fSnapshot = (): WatermarkSnapshot => ({
        hostAttached: fHost.isConnected && fHost.parentNode === container,
        frameAttached: frame.isConnected && frame.parentNode === container,
        attributesIntact: attributesAllowed(fHost.getAttributeNames()) && inlineStyleIntact(fInline, inlineOf(fHost)),
        hostPseudo: hasPseudoContent(fHost),
        textIntact: fBox.parentNode === fRoot && fId.parentNode === fBox && fId.textContent === idText,
        layers: [fHost, fBox, fId].map(layerOf),
        textColorAlpha: colorAlpha(getComputedStyle(fId).color),
        fontSizePx: Number.parseFloat(getComputedStyle(fId).fontSize),
        host: boxOf(fHost),
        container: boxOf(container),
        hostZ: zOf(fHost),
        expectedZ: look.zIndex,
        frameZ: zOf(frame)
      })
      let failures = 0
      for (const at of FLASH_CHECKS_MS) {
        later(() => {
          if (stopped) return
          let reason: TamperReason | null
          try {
            reason = inspectWatermark(fSnapshot())
          } catch {
            reason = 'removed'
          }
          if (!reason) return
          failures += 1
          if (failures < FLASH_CHECKS_MS.length) return
          stop()
          onTamperRef.current(reason)
        }, at)
      }
      later(() => {
        fHost.remove()
        if (flashHost === fHost) flashHost = null
        if (!stopped) later(showFlash, nextFlashDelayMs(false))
      }, FLASH_VISIBLE_MS)
    }

    const evaluate = (): void => {
      if (stopped) return
      let reason: TamperReason | null
      try {
        reason =
          inspectWatermark(snapshot()) ?? (tileHost && tileRoot ? inspectTiles(tileSnapshot(tileHost, tileRoot)) : null)
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
    if (tileHost && tileRoot) {
      observer.observe(tileHost, { attributes: true })
      observer.observe(tileRoot, { childList: true, subtree: true, attributes: true })
    }

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
    if (flash) later(showFlash, nextFlashDelayMs(true))

    setTextRef.current = (id) => {
      if (stopped) return
      writeText(id)
      if (tileHost) writePattern(id)
    }

    return () => {
      stop()
      setTextRef.current = null
      host.remove()
      tileHost?.remove()
    }
  }, [containerRef, frameRef, resetKey, flash, tiles])

  useEffect(() => {
    identityRef.current = identity
    setTextRef.current?.(identity)
  }, [identity])

  return null
}
