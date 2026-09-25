import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext } from './testing.ts'

describe('app', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  it('GET /api/v1/system/health returns ok', async () => {
    const res = await ctx.app.request('/api/v1/system/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  describe('error responses', () => {
    it('tags every response with a request id', async () => {
      const res = await ctx.app.request('/api/v1/system/health')
      expect(res.headers.get('X-Request-Id')).toMatch(/.+/)
    })

    it('returns JSON for unknown routes', async () => {
      const res = await ctx.app.request('/api/v1/nope')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    })

    it('returns invalid_request with the failing fields', async () => {
      const { token } = await ctx.login()
      const res = await ctx.app.request('/api/v1/history/plays?before=yesterday', { headers: { Cookie: `rc_session=${token}` } })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: 'invalid_request',
        issues: [{ path: 'before', message: expect.any(String) }],
      })
    })

    it('returns internal_error with the request id and logs it', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { token } = await ctx.login()
      ctx.spotify.getRecentlyPlayed.mockRejectedValueOnce(new Error('boom'))

      const res = await ctx.app.request('/api/v1/history/sync', {
        method: 'POST',
        headers: { Cookie: `rc_session=${token}`, Origin: 'http://127.0.0.1:5173' },
      })
      const requestId = res.headers.get('X-Request-Id')
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal_error', requestId })
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`[${requestId}] POST /api/v1/history/sync`), expect.any(Error))
      log.mockRestore()
    })

    it('returns forbidden as JSON when the origin check fails', async () => {
      const res = await ctx.app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
      })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'forbidden' })
    })
  })
})
