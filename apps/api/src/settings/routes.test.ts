import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'

describe('settings', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
  })
  afterEach(() => ctx.close())

  const get = () => ctx.app.request('/api/v1/settings', { headers: { Cookie: cookie } })
  const patch = (body: unknown) =>
    ctx.app.request('/api/v1/settings', {
      method: 'PATCH',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('play tracks from their album until changed', async () => {
    expect(await (await get()).json()).toEqual({ playTracksFrom: 'album' })
    const res = await patch({ playTracksFrom: 'playlist' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ playTracksFrom: 'playlist' })
    expect(await (await get()).json()).toEqual({ playTracksFrom: 'playlist' })
    // Nothing given changes nothing.
    expect(await (await patch({})).json()).toEqual({ playTracksFrom: 'playlist' })
  })

  it('refuse what they do not know', async () => {
    const res = await patch({ playTracksFrom: 'artist' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request', issues: [{ path: 'playTracksFrom' }] })
  })

  it('need a session', async () => {
    cookie = ''
    expect((await get()).status).toBe(401)
  })
})
