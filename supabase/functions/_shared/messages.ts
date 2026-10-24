// User-facing denial copy shared by mentorship Edge Functions. Messages never
// include legal names, tokens or upstream error bodies.

import { json } from './http.ts'

export type DenyCode =
  | 'unauthenticated'
  | 'invalid_session'
  | 'no_discord_identity'
  | 'not_a_member'
  | 'roles_unavailable'
  | 'level_insufficient'
  | 'forbidden'
  | 'onboarding_incomplete'
  | 'membership_inactive'
  | 'no_joining_record'
  | 'suspended'
  | 'name_unavailable'
  | 'service_unavailable'
  | 'video_not_found'
  | 'not_ready'
  | 'misconfigured'
  | 'invalid_request'
  | 'invalid_name'
  | 'upstream_failed'
  | 'tab_not_found'
  | 'tab_not_empty'

export const DENY_MESSAGES: Record<DenyCode, string> = {
  unauthenticated: 'Sign in with Discord to watch mentorship videos.',
  invalid_session: 'Your session expired. Sign in again to continue.',
  no_discord_identity:
    'Mentorship videos require a Discord-linked account. Sign out and sign in with Discord.',
  not_a_member:
    'We could not confirm you are in the mentorship Discord server. Rejoin the server or contact staff.',
  roles_unavailable:
    'We could not confirm your Discord roles right now. Try again shortly, or contact staff if this persists.',
  level_insufficient:
    'Your Discord roles do not include access to this video. Contact staff if you believe this is wrong.',
  forbidden: 'Your Discord roles do not allow this action.',
  onboarding_incomplete:
    'Your mentorship onboarding is incomplete. Finish joining in Discord (documents and payment) before watching videos.',
  membership_inactive:
    'Your mentorship access is not active. Open a ticket in Discord or message staff for help.',
  no_joining_record:
    "We couldn't find your mentorship joining record. Open a ticket in Discord or message staff for help.",
  suspended: 'Video access is currently restricted on your account. Contact staff for details.',
  name_unavailable:
    'Staff still need to complete your account details (legal name on file) before videos can play with your watermark.',
  service_unavailable:
    'The mentorship access service is temporarily unavailable. Video playback is paused until it recovers. Your local journal still works offline.',
  video_not_found: 'That video is not available.',
  not_ready: 'This video is still processing. Try again in a few minutes.',
  misconfigured: 'Video playback is not configured on the server yet. Contact staff.',
  invalid_request: 'That request was not valid.',
  invalid_name:
    'That is not a valid legal name. Enter the full name using letters (2 to 200 characters), with no placeholders.',
  upstream_failed: 'The video service could not complete that request. Try again shortly.',
  tab_not_found: 'That tab no longer exists.',
  tab_not_empty: 'Delete or move every video out of this tab before deleting it.'
}

export const DENY_STATUS: Record<DenyCode, number> = {
  unauthenticated: 401,
  invalid_session: 401,
  no_discord_identity: 403,
  not_a_member: 403,
  roles_unavailable: 503,
  level_insufficient: 403,
  forbidden: 403,
  onboarding_incomplete: 403,
  membership_inactive: 403,
  no_joining_record: 403,
  suspended: 403,
  name_unavailable: 403,
  service_unavailable: 503,
  video_not_found: 404,
  not_ready: 409,
  misconfigured: 500,
  invalid_request: 400,
  invalid_name: 400,
  upstream_failed: 502,
  tab_not_found: 404,
  tab_not_empty: 409
}

export function denyBody(reasonCode: DenyCode): { ok: false; reasonCode: DenyCode; message: string } {
  return { ok: false, reasonCode, message: DENY_MESSAGES[reasonCode] }
}

export function deny(reasonCode: DenyCode): Response {
  return json(denyBody(reasonCode), DENY_STATUS[reasonCode])
}
