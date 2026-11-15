// The real dependencies of the shared viewer gate (bot access check, NDA check, stored name), the
// playback audit writer and the tamper-flag DM, built once so the functions using them cannot
// drift apart. Callers must already have verified the core secrets are present.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { MentorshipContext, MentorshipEnv } from './context.ts'
import { readStoredName } from './memberNameStore.ts'
import { fetchMentorshipAccess } from './mentorshipApi.ts'
import { fetchNdaStatus } from './mentorshipNdaApi.ts'
import { evaluateNda } from './ndaGate.ts'
import { readEnforceFrom, readNdaCache, writeNdaCache } from './ndaStore.ts'
import type { AuditRow } from './playback.ts'
import { resolveCapabilities } from './roles.ts'
import {
  afterResponse,
  MAX_DM_RECIPIENTS,
  notifyStaffOfTamper,
  sendDiscordDm,
  TAMPER_DM_GAP_MS,
  type TamperDm
} from './staffAlerts.ts'
import type { TamperReport } from './tamper.ts'
import type { ViewerGateDeps } from './viewerGate.ts'
import {
  countEarlierTamperFlags,
  loadAlertTitles,
  readAppOnly,
  readHold,
  readRecentOpens,
  readTamperDmRecipients,
  setTamperDmRecipient,
  type RecordedTamper
} from './viewerSecurityStore.ts'

export function viewerGateDeps(
  admin: SupabaseClient,
  env: MentorshipEnv,
  bot: { baseUrl: string; token: string },
  renewLeadSeconds: number
): ViewerGateDeps {
  return {
    checkMentorship: (discordId) =>
      fetchMentorshipAccess({
        baseUrl: bot.baseUrl,
        token: bot.token,
        discordId,
        allowLocalHttp: env.allowLocalHttp
      }),
    checkNda: ({ discordId, isStaff }) =>
      evaluateNda({
        isStaff,
        discordId,
        now: Date.now(),
        lookup: (id) =>
          fetchNdaStatus({
            baseUrl: bot.baseUrl,
            token: bot.token,
            discordId: id,
            allowLocalHttp: env.allowLocalHttp
          }),
        readEnforceFrom: () => readEnforceFrom(admin),
        readCache: (id) => readNdaCache(admin, id),
        writeCache: (id) => writeNdaCache(admin, id)
      }),
    readStoredName: async (discordId) => {
      const stored = await readStoredName(admin, discordId)
      return stored.ok ? stored.value : null
    },
    checkHold: (discordId) => readHold(admin, discordId),
    readAppOnly: () => readAppOnly(admin),
    recentOpens: (userId) => readRecentOpens(admin, userId),
    ttlSeconds: env.playbackTtlSeconds,
    renewLeadSeconds
  }
}

export function playbackAuditWriter(admin: SupabaseClient): (row: AuditRow) => Promise<void> {
  return async (row) => {
    try {
      await admin.from('playback_audit').insert(row)
    } catch {
      // Audit must never break the response path.
    }
  }
}

async function tamperItem(
  admin: SupabaseClient,
  alert: RecordedTamper
): Promise<Pick<TamperDm, 'itemKind' | 'itemTitle'>> {
  const titles = await loadAlertTitles(admin, [
    { video_id: alert.videoId, recording_id: alert.recordingId, document_id: alert.documentId }
  ]).catch(() => null)
  if (alert.videoId) return { itemKind: 'video', itemTitle: titles?.videos.get(alert.videoId) ?? null }
  if (alert.recordingId) return { itemKind: 'recording', itemTitle: titles?.recordings.get(alert.recordingId) ?? null }
  if (alert.documentId) return { itemKind: 'document', itemTitle: titles?.documents.get(alert.documentId) ?? null }
  return { itemKind: null, itemTitle: null }
}

/**
 * After recordTamper wrote a new flag: DMs the owners and admins who asked for it
 * (staffAlerts.ts), once the response has gone back to the player.
 */
export function notifyTamper(
  ctx: MentorshipContext,
  viewer: { discordId: string; username?: string },
  report: TamperReport,
  recorded: { held: boolean; alert?: RecordedTamper }
): Promise<void> {
  const alert = recorded.alert
  if (!alert) return Promise.resolve()
  const { admin, env, authzDeps } = ctx
  const task = (async () => {
    const item = await tamperItem(admin, alert)
    await notifyStaffOfTamper(
      {
        recipients: () => readTamperDmRecipients(admin, MAX_DM_RECIPIENTS),
        earlierFlags: () => countEarlierTamperFlags(admin, viewer.discordId, alert, TAMPER_DM_GAP_MS),
        isManager: async (discordId) => {
          const member = await authzDeps.fetchMember(discordId)
          if (member.kind === 'not_member') return 'no'
          if (member.kind !== 'member') return 'unknown'
          return resolveCapabilities(member.roles, env.roleConfig).isManager ? 'yes' : 'no'
        },
        removeRecipient: async (discordId) => {
          await setTamperDmRecipient(admin, discordId, false)
        },
        send: (discordId, message) => sendDiscordDm(env.botToken, discordId, message)
      },
      {
        memberDiscordId: viewer.discordId,
        memberUsername: viewer.username,
        reason: report.reason,
        platform: report.platform,
        ...item,
        held: recorded.held,
        at: Date.parse(alert.createdAt) || Date.now()
      }
    )
  })()
  return afterResponse(task)
}
