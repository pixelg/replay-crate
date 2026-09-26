import type { OpenAPIHono, RouteConfig } from '@hono/zod-openapi'
import type { ZodType } from 'zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_BASE } from './app.ts'
import { createTestContext, CRON_SECRET, paged, REDIRECT_URI, play, playlist, playlistContext, playlistEntry, track } from './testing.ts'

/**
 * The spec's response schemas only check types at compile time. This calls the API with
 * real data and checks every body against the schema its route declares, including that
 * it has no fields the spec doesn't mention (mocks and clients are built from the spec).
 */
describe('responses match the spec', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  const checked: string[] = []
  const mismatches: string[] = []

  /** Route definitions by `METHOD /path`, paths relative to the API base. */
  let routes: Map<string, RouteConfig>

  async function call(
    method: string,
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const url = API_BASE + path.replaceAll(/\{(\w+)\}/g, (_, name: string) => params[name]!)
    const res = await ctx.app.request(url, {
      method,
      headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const key = `${method} ${path.split('?')[0]}`
    const response = routes.get(key)?.responses[res.status]
    const schema = (response as { content?: Record<string, { schema?: ZodType }> } | undefined)?.content?.[
      'application/json'
    ]?.schema
    // oxlint-disable-next-line typescript/no-explicit-any
    const json: any = res.status === 204 ? null : await res.json()
    checked.push(key)
    if (!response) {
      mismatches.push(`${key}: ${res.status} is not a declared response`)
    } else if (schema) {
      const parsed = schema.safeParse(json)
      if (!parsed.success) mismatches.push(`${key} ${res.status}: ${parsed.error.message}`)
      // Parsing drops unknown keys, so a difference means the body has undocumented fields.
      else if (JSON.stringify(parsed.data) !== JSON.stringify(json)) {
        mismatches.push(`${key} ${res.status}: body has fields the spec doesn't declare`)
      }
    }
    return json
  }

  beforeAll(async () => {
    ctx = await createTestContext()
    const app = ctx.app as unknown as OpenAPIHono
    routes = new Map(
      app.openAPIRegistry.definitions.flatMap((d) =>
        d.type === 'route' ? [[`${d.route.method.toUpperCase()} ${d.route.path}`, d.route as RouteConfig]] : [],
      ),
    )
    cookie = `rc_session=${(await ctx.login()).token}`

    // Some history, from a playlist the user owns, so every response has real content.
    const song = track('4uLU6hMCjMI75M1A2tKUQC', { name: 'Song' })
    ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) => paged([playlist('road', { total: 1 })])(offset))
    ctx.spotify.getPlaylistItems.mockImplementation(async (_token, _id, offset) => paged([playlistEntry(song)])(offset))
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [play(song, '2026-09-21T11:00:00.000Z', playlistContext('road')), play(track('b'), '2026-09-21T11:30:00.000Z')],
      cursors: null,
    })
  })
  afterAll(() => ctx.close())

  it('for every endpoint', async () => {
    await call('GET', '/system/health')
    await call('POST', '/auth/callback', {}, { code: 'code-2', codeVerifier: 'v'.repeat(64), redirectUri: REDIRECT_URI })
    await call('POST', '/history/sync')
    await call('POST', '/playlists/sync')

    const { id } = await call('POST', '/imports')
    const imported = { id: String(id) }
    await call('POST', '/imports/{id}/plays', imported, {
      plays: [{ ts: '2026-01-02T10:00:00Z', ms: 200_000, trackId: '4uLU6hMCjMI75M1A2tKUQC' }],
    })
    await call('POST', '/imports/{id}/finish', imported)
    await call('GET', '/imports/latest')

    // Rated before the reads below, so their bodies carry a rating.
    await call('PUT', '/tracks/{id}/rating', { id: '4uLU6hMCjMI75M1A2tKUQC' }, { rating: 4 })
    await call('PUT', '/tracks/{id}/rating', { id: '4uLU6hMCjMI75M1A2tKUQC' }, { rating: 9 })
    await call('GET', '/system/jobs')
    await call('GET', '/auth/me')
    await call('GET', '/history/plays')
    await call('GET', '/history/plays?limit=1&offset=1')
    await call('GET', '/history/plays?offset=0&before=2026-01-01T00:00:00.000Z')
    await call('GET', '/history/gaps')
    const { nextCursor } = await call('GET', '/tracks?sort=name&limit=1')
    await call('GET', `/tracks?sort=name&cursor=${nextCursor}`)
    await call('GET', '/tracks?cursor=nope')
    await call('GET', '/tracks?sort=rating&limit=1&offset=1')
    await call('GET', '/tracks/{id}', { id: '4uLU6hMCjMI75M1A2tKUQC' })
    await call('GET', '/tracks/{id}', { id: 'nope' })
    await call('GET', '/playlists')
    await call('GET', '/playlists/{id}', { id: 'road' })
    await call('POST', '/playlists/preview', {}, { rule: { kind: 'top', range: 'all', limit: 5 } })
    await call('POST', '/playlists/preview', {}, { rule: { kind: 'top_rated', minRating: 4 } })
    await call('GET', '/tracks?sort=rating&minRating=4')
    const { id: created } = await call('POST', '/playlists', {}, { name: 'New', trackIds: ['4uLU6hMCjMI75M1A2tKUQC'] })
    await call('POST', '/playlists/{id}/items', { id: created }, { trackIds: ['b'] })
    await call('PUT', '/playlists/{id}/items/move', { id: created }, { from: 1, to: 0 })
    await call('DELETE', '/playlists/{id}/items', { id: created }, { trackIds: ['b'] })
    await call('GET', '/stats/overview?range=all')
    await call('GET', '/stats/top?type=tracks')
    await call('GET', '/stats/top?type=artists&metric=minutes')
    await call('GET', '/stats/top?type=albums')
    await call('GET', '/stats/spotify-top?type=tracks')
    await call('GET', '/stats/spotify-top?type=artists')
    await call('GET', '/history/plays?limit=0')
    await call('GET', '/player')
    await call('PUT', '/player/play', {}, { uris: ['spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'spotify:track:b'] })
    await call('POST', '/player/queue', {}, { uri: 'spotify:track:b' })
    await call('GET', '/player')
    await call('GET', '/player/queue')
    await call('GET', '/player/devices')
    await call('POST', '/player/next', {}, {})
    await call('POST', '/player/previous', {}, {})
    await call('PUT', '/player/seek', {}, { positionMs: 1_000 })
    await call('PUT', '/player/shuffle', {}, { on: true })
    await call('PUT', '/player/repeat', {}, { state: 'track' })
    await call('PUT', '/player/volume', {}, { percent: 40 })
    await call('PUT', '/player/pause', {}, {})
    await call('PUT', '/player/device', {}, { deviceId: 'phone' })
    await call('PUT', '/player/volume', {}, { percent: 40 })
    ctx.player.deactivate()
    await call('GET', '/player')
    await call('PUT', '/player/play', {}, { uris: ['spotify:track:b'] })
    await call('DELETE', '/tracks/{id}/rating', { id: '4uLU6hMCjMI75M1A2tKUQC' })
    await call('POST', '/system/cron/poll', {}, undefined, { Authorization: `Bearer ${CRON_SECRET}` })
    await call('POST', '/auth/logout')
    await call('GET', '/auth/me')

    expect(mismatches).toEqual([])
    // Every route was exercised (query strings aside).
    const hit = new Set(checked.map((c) => c.split(' ').slice(0, 2).join(' ')))
    expect([...routes.keys()].filter((key) => !hit.has(key))).toEqual([])
  })
})
