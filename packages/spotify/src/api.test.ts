import { describe, expect, it, vi } from 'vitest'
import { SpotifyApiError, spotifyGet } from './api.ts'
import { pickImage } from './images.ts'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('spotifyGet', () => {
  it('sends the bearer token and returns JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { id: 'me' }))
    await expect(spotifyGet('/me', 'token-1', { fetchFn })).resolves.toEqual({ id: 'me' })
    expect(fetchFn).toHaveBeenCalledWith('https://api.spotify.com/v1/me', {
      headers: { Authorization: 'Bearer token-1' },
    })
  })

  it('waits out a short Retry-After and retries', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, { ok: true }))

    await expect(spotifyGet('/x', 't', { fetchFn, sleep })).resolves.toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('gives up on a long Retry-After and reports it', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(429, {}, { 'Retry-After': '120' }))
    const error = await spotifyGet('/x', 't', { fetchFn, sleep: async () => {} }).catch((e) => e)
    expect(error).toBeInstanceOf(SpotifyApiError)
    expect(error).toMatchObject({ status: 429, retryAfter: 120 })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('throws SpotifyApiError with the status on other failures', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(404, { error: { status: 404 } }))
    await expect(spotifyGet('/playlists/x', 't', { fetchFn })).rejects.toMatchObject({ status: 404 })
  })
})

describe('pickImage', () => {
  const images = [
    { url: 'L', width: 640, height: 640 },
    { url: 'M', width: 300, height: 300 },
    { url: 'S', width: 64, height: 64 },
  ]

  it('picks the smallest image at least as wide as the target', () => {
    expect(pickImage(images, 64)).toBe('S')
    expect(pickImage(images, 200)).toBe('M')
    expect(pickImage(images, 1000)).toBe('L')
  })

  it('handles missing or unsized images', () => {
    expect(pickImage([], 64)).toBeNull()
    expect(pickImage(null, 64)).toBeNull()
    expect(pickImage([{ url: 'U', width: null, height: null }], 64)).toBe('U')
  })
})
