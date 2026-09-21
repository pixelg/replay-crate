import { Hono } from 'hono'
import type { AppDeps } from '../deps.ts'
import { syncAllUsers } from './all-users.ts'

/** Called by a hosted scheduler (GitHub Actions, once deployed) to sync every connected user. */
export function cronRoutes(deps: AppDeps) {
  return new Hono().post('/cron/poll', async (c) => {
    if (!deps.cronSecret) return c.json({ error: 'cron_disabled' as const }, 503)
    if (!(await secretsMatch(c.req.header('Authorization') ?? '', `Bearer ${deps.cronSecret}`))) {
      return c.json({ error: 'unauthorized' as const }, 401)
    }
    return c.json({ users: await syncAllUsers(deps) }, 200)
  })
}

/** Constant-time comparison: hash both sides, then compare the fixed-length digests. */
async function secretsMatch(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
