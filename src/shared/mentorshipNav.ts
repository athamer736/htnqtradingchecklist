import type { MentorshipCapabilities, MentorshipTab } from './video'

// Mentorship navigation. The server decides which tabs a member may open (from
// their live Discord roles and each tab's role lists) and returns only those, so
// the sidebar simply shows what it was given, plus the fixed Recordings page.
// This only hides navigation; every list and playback request is still
// re-checked server-side.

/** The view id for a tab's page, e.g. `tab:3f2a…`. */
export type TabViewId = `tab:${string}`

const TAB_PREFIX = 'tab:'

export function tabView(tabId: string): TabViewId {
  return `${TAB_PREFIX}${tabId}`
}

/** The tab id a view id points at, or null when it is not a tab view. */
export function tabIdFromView(view: string): string | null {
  return view.startsWith(TAB_PREFIX) && view.length > TAB_PREFIX.length ? view.slice(TAB_PREFIX.length) : null
}

export function isMentorshipPage(view: string): boolean {
  return view === 'recordings' || tabIdFromView(view) !== null
}

/**
 * Whether a Mentorship page should appear for these capabilities and tabs. Unknown
 * capabilities (not loaded, or the check failed) show nothing.
 */
export function canSeeMentorshipPage(
  caps: MentorshipCapabilities | null,
  tabs: readonly MentorshipTab[],
  view: string
): boolean {
  if (!caps) return false
  if (view === 'recordings') return caps.isStaff || caps.isStudent
  const id = tabIdFromView(view)
  return id !== null && tabs.some((t) => t.id === id)
}

/** The Admin page: owners and admins, and anyone holding a "tab manager" role. */
export function canOpenAdmin(caps: MentorshipCapabilities | null): boolean {
  return Boolean(caps && (caps.isManager || caps.canManageTabs))
}
