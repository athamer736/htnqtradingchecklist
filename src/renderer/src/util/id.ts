// Generates a unique id. Uses crypto.randomUUID when available (secure contexts),
// with a fallback for non-secure contexts (e.g. opening the file:// build directly).
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
