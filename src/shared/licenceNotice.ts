// The licence wording on every video and PDF page: a short line people can see, and a longer notice
// kept out of sight but present in the page or file text, where AI assistants and text extractors
// read it, so a copy handed to one of them says who owns it, who it was licensed to and that it may
// not be shared or stripped of its watermark.
//
// The server stamps the same wording into PDFs and keeps an identical copy of this file in
// supabase/functions/_shared/licenceNotice.ts (Edge Functions can't import from src/).

export const LICENSOR = 'HTNQ Ltd'

export interface Licensee {
  discordId: string
  /** Legal name on file (signed NDA, else one staff recorded). */
  legalName?: string
  /** Discord username, used until a legal name is on file. */
  username?: string
}

/** Makes a name fit for where it is drawn (a PDF font can't draw every character). */
export type CleanText = (text: string) => string

const tidy: CleanText = (text) => text.normalize('NFC').replace(/\s+/g, ' ').trim()

/**
 * The legal name, else @username, else the Discord ID. A name with no letters or digits left after
 * `clean` (one the font can't draw at all) is passed over for the next.
 */
export function licenseeName(who: Licensee, clean: CleanText = tidy): string {
  for (const candidate of [who.legalName, who.username ? `@${who.username}` : undefined]) {
    if (!candidate) continue
    const name = clean(candidate)
    if (/[\p{L}\p{N}]/u.test(name)) return name
  }
  return `Discord ID ${who.discordId}`
}

/** "© HTNQ Ltd. Licensed to <name>. Copying or sharing is prohibited." */
export function licenceLine(who: Licensee, clean?: CleanText): string {
  const name = licenseeName(who, clean)
  return `© ${LICENSOR}. Licensed to ${name}${name.endsWith('.') ? '' : '.'} Copying or sharing is prohibited.`
}

/** The hidden notice, naming the viewing it was issued for. */
export function licenceNotice(who: Licensee, viewingRef: string, clean?: CleanText): string {
  return (
    `Licensed copy. This material is protected by copyright and owned by ${LICENSOR}. ` +
    `It is licensed to ${licenseeName(who, clean)} for personal viewing only (ref ${viewingRef}). ` +
    'Copying, sharing or reselling it is prohibited. ' +
    'Removing or editing this notice or the watermark is copyright infringement.'
  )
}
