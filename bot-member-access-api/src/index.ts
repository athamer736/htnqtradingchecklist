import { createServer, type Server } from 'node:http'
import { loadConfigFromEnv, type MemberAccessConfig } from './config.js'
import {
  createMemberAccessHandler,
  jsonLineLogger,
  type MemberAccessLogger,
  type MemberAccessRecords
} from './handler.js'

export * from './contract.js'
export * from './decision.js'
export * from './config.js'
export * from './handler.js'
export { FixedWindowLimiter } from './rateLimit.js'

/**
 * Builds the handler from env. Throws (with env var names only, never values)
 * if MEMBER_ACCESS_API_TOKEN is missing, weak, or reused from another secret,
 * so a misconfigured deploy fails at boot instead of serving.
 */
export function memberAccessHandlerFromEnv(
  records: MemberAccessRecords,
  opts: { env?: Record<string, string | undefined>; logger?: MemberAccessLogger } = {}
) {
  const result = loadConfigFromEnv(opts.env ?? process.env)
  if (!result.ok) throw new Error(`member-access API not started: ${result.error}`)
  return createMemberAccessHandler({ config: result.config, records, logger: opts.logger })
}

/** Standalone server for bots that don't already run an HTTP server. Railway provides PORT. */
export function startMemberAccessServer(
  records: MemberAccessRecords,
  opts: { port?: number; config?: MemberAccessConfig; logger?: MemberAccessLogger } = {}
): Server {
  const handler = opts.config
    ? createMemberAccessHandler({ config: opts.config, records, logger: opts.logger })
    : memberAccessHandlerFromEnv(records, { logger: opts.logger })
  const server = createServer((req, res) => {
    void handler(req, res)
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50
  const port = opts.port ?? Number(process.env.PORT ?? 3000)
  server.listen(port, () => (opts.logger ?? jsonLineLogger).info('member_access_listening', { port }))
  return server
}
