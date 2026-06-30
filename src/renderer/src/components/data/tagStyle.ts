import type { CSSProperties } from 'react'

// Translucent chip styling from a tag's hex color (Notion-like look on dark bg).
export function tagStyle(color: string): CSSProperties {
  return {
    backgroundColor: `${color}22`,
    color,
    borderColor: `${color}55`
  }
}
