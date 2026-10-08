export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Cache-Control': 'no-store'
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

/** Read JSON body with a hard size cap. */
export async function readJsonBody(
  req: Request,
  maxBytes = 4096
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > maxBytes) {
    return { ok: false, error: 'body-too-large' }
  }
  try {
    const text = await req.text()
    if (text.length > maxBytes) return { ok: false, error: 'body-too-large' }
    if (!text) return { ok: true, value: {} }
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
}

export function newSessionRef(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}
