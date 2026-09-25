import { createRoute, z } from '@hono/zod-openapi'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requireUser } from '../auth/middleware.ts'
import { createTestContext } from '../testing.ts'
import { createRouter, errorResponses, signedIn } from './openapi.ts'

describe('errorResponses', () => {
  it('declares each code under its status, plus internal_error', () => {
    const responses = errorResponses('unauthorized', 'not_found')
    expect(Object.keys(responses).sort()).toEqual(['401', '404', '500'])
    expect(responses[404].content['application/json'].schema.parse({ error: 'not_found' })).toEqual({
      error: 'not_found',
    })
    expect(responses[404].content['application/json'].schema.safeParse({ error: 'unauthorized' }).success).toBe(false)
  })
})

describe('createRouter', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  // A route shaped like the real ones: signed in, validated query, declared errors.
  function probe() {
    const route = createRoute({
      method: 'get',
      path: '/probe',
      tags: ['System'],
      operationId: 'probe',
      middleware: [requireUser(ctx.deps)] as const,
      security: signedIn,
      request: { query: z.object({ limit: z.coerce.number().int().min(1) }) },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: z.object({ user: z.string(), limit: z.number() }) } } },
        ...errorResponses('invalid_request', 'unauthorized'),
      },
    })
    // c.var.user comes typed from the route's middleware.
    return createRouter().openapi(route, (c) => c.json({ user: c.var.user.id, limit: c.req.valid('query').limit }, 200))
  }

  it('returns the standard invalid_request body when validation fails', async () => {
    const { token } = await ctx.login()
    const res = await probe().request('/probe?limit=0', { headers: { Cookie: `rc_session=${token}` } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request', issues: [{ path: 'limit', message: expect.any(String) }] })
  })

  it('runs route middleware before the handler', async () => {
    const app = probe()
    expect((await app.request('/probe?limit=5')).status).toBe(401)

    const { token } = await ctx.login()
    const res = await app.request('/probe?limit=5', { headers: { Cookie: `rc_session=${token}` } })
    expect(await res.json()).toEqual({ user: 'pixelg', limit: 5 })
  })

  it('documents the route', () => {
    const doc = probe().getOpenAPI31Document({ openapi: '3.1.0', info: { title: 't', version: '1' } })
    const op = doc.paths?.['/probe']?.get
    expect(op?.tags).toEqual(['System'])
    expect(op?.security).toEqual(signedIn)
    expect(Object.keys(op?.responses ?? {}).sort()).toEqual(['200', '400', '401', '500'])
  })
})
