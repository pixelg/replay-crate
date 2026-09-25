import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from './server.ts'
import { createTestContext } from './testing.ts'

describe('createServer with the built web app', () => {
  let dist: string
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let server: ReturnType<typeof createServer>

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'replay-crate-dist-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>')
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")')
    writeFileSync(join(dist, 'favicon.svg'), '<svg/>')
  })
  afterAll(() => rmSync(dist, { recursive: true, force: true }))

  beforeEach(async () => {
    ctx = await createTestContext()
    server = createServer(ctx.deps, { webDistDir: dist })
  })
  afterEach(() => ctx.close())

  it('serves index.html at the root', async () => {
    const res = await server.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<div id="root">')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('serves hashed assets with a long cache', async () => {
    const res = await server.request('/assets/index-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it('falls back to index.html for client-side routes', async () => {
    for (const path of ['/history', '/playlists/abc', '/callback?code=x&state=y']) {
      const res = await server.request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<div id="root">')
    }
  })

  it('keeps the API as JSON, including unknown routes and errors', async () => {
    expect(await (await server.request('/api/v1/system/health')).json()).toEqual({ ok: true })

    const missing = await server.request('/api/v1/nope')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not_found' })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { token } = await ctx.login()
    ctx.spotify.getRecentlyPlayed.mockRejectedValueOnce(new Error('boom'))
    const crashed = await server.request('/api/v1/history/sync', {
      method: 'POST',
      headers: { Cookie: `rc_session=${token}`, Origin: 'http://127.0.0.1:5173' },
    })
    expect(crashed.status).toBe(500)
    expect(await crashed.json()).toMatchObject({ error: 'internal_error', requestId: expect.any(String) })
  })

  it('is just the API when no web app is given', async () => {
    const apiOnly = createServer(ctx.deps)
    expect((await apiOnly.request('/')).status).toBe(404)
    expect((await apiOnly.request('/api/v1/system/health')).status).toBe(200)
  })
})
