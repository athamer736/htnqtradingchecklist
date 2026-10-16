// Static guards: the shared bot token and other backend secrets must never be
// referenced from code or config that ships to browsers / Electron, and the
// playback path must not log or persist legal names.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { TOKEN as MOCK_TOKEN } from './mocks/mentorshipAccessMock.ts'

const ROOT = join(import.meta.dirname, '..')

function walk(dir: string, exts: RegExp): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) return [abs]
  const out: string[] = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p, exts))
    else if (exts.test(entry.name)) out.push(join(ROOT, p))
  }
  return out
}

const SOURCE = /\.(ts|tsx|js|mjs|cjs|html|json|ya?ml)$/
/** Everything that is compiled into, or configures, the web/Electron client. */
const CLIENT_FILES = [
  ...walk('src', SOURCE),
  ...walk('vite.web.config.ts', SOURCE),
  ...walk('electron.vite.config.ts', SOURCE),
  ...walk('electron-builder.yml', SOURCE),
  ...walk('.github/workflows', SOURCE)
]
/** Build output, when present locally (dist-web is committed; out/ after `npm run build`). */
const BUILT_FILES = [...walk('dist-web', /\.(html|js|css)$/), ...walk('out', /\.(html|js)$/)]

const BACKEND_SECRETS = [
  'MENTORSHIP_API_TOKEN',
  'MEMBER_ACCESS_API_TOKEN',
  'MENTORSHIP_API_BASE_URL',
  'BUNNY_STREAM_TOKEN_KEY',
  'BUNNY_STREAM_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DISCORD_BOT_TOKEN',
  'STRIPE_SECRET_KEY'
]
const PUBLIC_VITE_VARS = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])

const rel = (f: string) => relative(ROOT, f)

describe('no backend secrets in client code, config or bundles', () => {
  it('finds client files to scan', () => {
    assert.ok(CLIENT_FILES.length > 20)
  })

  it('client sources and build config never reference backend secret names', () => {
    const hits: string[] = []
    for (const file of [...CLIENT_FILES, ...BUILT_FILES]) {
      const text = readFileSync(file, 'utf8')
      for (const name of BACKEND_SECRETS) if (text.includes(name)) hits.push(`${rel(file)}: ${name}`)
    }
    assert.deepEqual(hits, [])
  })

  it('only the public Supabase URL and anon key are exposed through VITE_ variables', () => {
    const files = [...CLIENT_FILES, ...walk('.env.example', /.*/)]
    const extra = new Set<string>()
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bVITE_[A-Z0-9_]+/g)) {
        if (!PUBLIC_VITE_VARS.has(m[0])) extra.add(`${rel(file)}: ${m[0]}`)
      }
    }
    assert.deepEqual([...extra], [])
  })

  it('built bundles contain no test or bearer tokens', () => {
    for (const file of BUILT_FILES) {
      const text = readFileSync(file, 'utf8')
      assert.ok(!text.includes(MOCK_TOKEN), rel(file))
      assert.ok(!/Bearer [A-Za-z0-9._~+/=-]{32,}/.test(text), rel(file))
      assert.ok(!text.includes('/api/v1/member-access'), `${rel(file)} must not call the bot directly`)
    }
  })

  it('the renderer never calls the bot API directly', () => {
    for (const file of CLIENT_FILES) {
      assert.ok(!readFileSync(file, 'utf8').includes('member-access'), rel(file))
    }
  })
})

describe('no legal names in logs or persistent client storage', () => {
  it('Edge Functions never write to the console', () => {
    const hits = walk('supabase/functions', /\.ts$/).filter((f) => /\bconsole\.\w+\(/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(hits.map(rel), [])
  })

  it('playback client code neither logs nor persists playback data', () => {
    const files = [
      'src/renderer/src/store/useMentorship.ts',
      'src/renderer/src/components/video/VideoPlayer.tsx',
      'src/renderer/src/components/video/WatermarkOverlay.tsx',
      'src/renderer/src/components/video/PlaybackNotice.tsx',
      'src/shared/playbackSession.ts'
    ].map((f) => join(ROOT, f))
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      assert.ok(!/\bconsole\.\w+\(/.test(text), `${rel(file)} logs`)
      assert.ok(!/localStorage|sessionStorage|indexedDB|electron-store|useLogs|logger\./.test(text), `${rel(file)} persists`)
    }
  })
})
