import { FURTHER_STUDYING_LEVEL, SECTION_LABELS, isBatchSection, levelsInclude, type ContentSection, type MentorshipCapabilities, type VideoLevel } from './video'

/** Why a non-staff caller cannot see this section, or null when they can. */
export function lockReason(
  caps: MentorshipCapabilities,
  section: ContentSection,
  level: VideoLevel | null
): string | null {
  if (caps.isStaff) return null
  if (caps.isPartial) {
    if (section === 'level' && (level === 1 || level === 2) && levelsInclude(caps.levels, level)) return null
    return 'Your payment plan currently includes Levels 1–2 only. Full access requires at least £1,500 paid, the 14-day period to have ended, and completed onboarding.'
  }
  if (!caps.isStudent) {
    return 'Mentorship content needs the Student role in the HTNQ Discord. Contact staff if you believe this is wrong.'
  }
  if (section === 'level' && level !== null && !levelsInclude(caps.levels, level)) {
    const roles = ([1, 2, 3] as VideoLevel[]).filter((l) => l >= level).map((l) => `Level ${l}`)
    return `Level ${level} unlocks with the ${roles.join(' or ')} Discord role.`
  }
  if (section === 'further_studying' && !levelsInclude(caps.levels, FURTHER_STUDYING_LEVEL)) {
    return 'Further Studying unlocks with the Level 3 Discord role.'
  }
  if (isBatchSection(section) && !(caps.batches ?? []).includes(section)) {
    return `${SECTION_LABELS[section]} unlocks with the ${SECTION_LABELS[section]} Discord role.`
  }
  return null
}

