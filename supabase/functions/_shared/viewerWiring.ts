// The real dependencies of the shared viewer gate (bot access check, NDA check, stored name) and
// the playback audit writer, built once so issue-playback-token and issue-document cannot drift
// apart. Callers must already have verified the core secrets are present.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { MentorshipEnv } from './context.ts'
import { readStoredName } from './memberNameStore.ts'
import { fetchMentorshipAccess } from './mentorshipApi.ts'
import { fetchNdaStatus } from './mentorshipNdaApi.ts'
import { evaluateNda } from './ndaGate.ts'
import { readEnforceFrom, readNdaCache, writeNdaCache } from './ndaStore.ts'
import type { AuditRow } from './playback.ts'
import type { ViewerGateDeps } from './viewerGate.ts'

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
