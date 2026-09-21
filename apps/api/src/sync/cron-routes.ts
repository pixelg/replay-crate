import { schema } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppDeps } from '../deps.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from './recently-played.ts'

/** Called on a schedule (GitHub Actions, once deployed) to sync every connected user. */
export function cronRoutes(deps: AppDeps) {
  return new Hono().post('/cron/poll', async (c) => {
    if (!deps.cronSecret) return c.json({ error: 'cron_disabled' as const }, 503)
    if (!(await secretsMatch(c.req.header('Authorization') ?? '', `Bearer ${deps.cronSecret}`))) {
      return c.json({ error: 'unauthorized' as const }, 401)
    }

    const active = await deps.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.needsReauth, false))

    const results = []
    for (const { id } of active) {
      try {
        const { inserted } = await syncRecentlyPlayed(deps, id)
        results.push({ userId: id, inserted })
      } catch (error) {
        if (!(error instanceof ReauthRequiredError)) console.error(`cron sync failed for ${id}`, error)
        results.push({ userId: id, error: error instanceof ReauthRequiredError ? 'reauth_required' : 'failed' })
      }
    }
    return c.json({ users: results }, 200)
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
