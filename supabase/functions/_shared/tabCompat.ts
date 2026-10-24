// The ONE place that knows how the old, fixed Mentorship sections map to tabs.
//
// Installed 2.0.2 apps (and the live website until it redeploys) still speak in
// `{ section, level }`. The server translates that to and from the seeded tabs'
// slugs here so those clients keep working while 2.0.3 rolls out. Tabs an admin
// creates have no legacy equivalent: old clients simply never see them.
//
// Once 2.0.2 is retired this file, and the legacy fields it feeds, can be removed.

export type LegacySection =
  | 'level'
  | 'lectures'
  | 'weekly_recaps'
  | 'further_studying'
  | 'july_batch'
  | 'sept_batch'
  | 'batch_5'

/** Slugs of the tabs the migration seeds from the old fixed sections. */
export const LEGACY_TAB_SLUGS = [
  'level_1',
  'level_2',
  'level_3',
  'further_studying',
  'lectures',
  'weekly_recaps',
  'july_batch',
  'sept_batch',
  'batch_5'
] as const

export type LegacyLevel = 1 | 2 | 3

export function isLegacySlug(slug: unknown): boolean {
  return typeof slug === 'string' && (LEGACY_TAB_SLUGS as readonly string[]).includes(slug)
}

/** `{ section, level }` from an old client -> the seeded tab's slug, or null if invalid. */
export function slugForLegacy(section: unknown, level: unknown): string | null {
  if (section === 'level') {
    return level === 1 || level === 2 || level === 3 ? `level_${level}` : null
  }
  if (level !== null && level !== undefined) return null
  switch (section) {
    case 'lectures':
    case 'weekly_recaps':
    case 'further_studying':
    case 'july_batch':
    case 'sept_batch':
    case 'batch_5':
      return section
    default:
      return null
  }
}

/**
 * The values stored in the old `videos.section` / `videos.level` columns for a tab.
 * Admin-created tabs store `custom`, which the migration allows and old clients ignore.
 */
export function legacyLocation(slug: string): { section: LegacySection | 'custom'; level: LegacyLevel | null } {
  const m = /^level_([123])$/.exec(slug)
  if (m) return { section: 'level', level: Number(m[1]) as LegacyLevel }
  if (isLegacySlug(slug)) return { section: slug as LegacySection, level: null }
  return { section: 'custom', level: null }
}
