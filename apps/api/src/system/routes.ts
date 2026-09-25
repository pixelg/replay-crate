import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { jobStatus } from '../jobs/queue.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { jsonResponse } from '../lib/schemas.ts'
import { syncAllUsers } from '../sync/all-users.ts'

const health = createRoute({
  method: 'get',
  path: '/system/health',
  tags: ['System'],
  operationId: 'getHealth',
  summary: 'Liveness check',
  responses: { 200: jsonResponse(z.object({ ok: z.literal(true) }), 'The API is up.'), ...errorResponses() },
})

const jobs = createRoute({
  method: 'get',
  path: '/system/jobs',
  tags: ['System'],
  operationId: 'getJobs',
  summary: "The user's queued Spotify lookups",
  description: 'Background catalog lookups still queued for this user, e.g. after an import.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        pending: z.number().int().openapi({ description: 'Jobs waiting to run.' }),
        failing: z.number().int().openapi({ description: 'Of those, jobs that have failed at least once.' }),
      }),
      'Queue counts.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const poll = createRoute({
  method: 'post',
  path: '/system/cron/poll',
  tags: ['System'],
  operationId: 'pollAllUsers',
  summary: "Sync every user's recent plays",
  description:
    'Called by a hosted scheduler (GitHub Actions, once deployed). Authenticates with ' +
    '`Authorization: Bearer <CRON_SECRET>`, not a user session.',
  security: [{ bearer: [] }],
  responses: {
    200: jsonResponse(
      z.object({
        users: z.array(
          z.union([
            z.object({ userId: z.string(), inserted: z.number().int() }),
            z.object({ userId: z.string(), error: z.enum(['reauth_required', 'failed']) }),
          ]),
        ),
      }),
      'One result per connected user.',
    ),
    ...errorResponses('unauthorized', 'cron_disabled'),
  },
})

export function systemRoutes(deps: AppDeps) {
  const auth = requireUser(deps)

  return createRouter()
    .openapi(health, (c) => c.json({ ok: true as const }, 200))
    .openapi({ ...jobs, middleware: auth }, async (c) => c.json(await jobStatus(deps.db, c.var.user.id), 200))
    .openapi(poll, async (c) => {
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
