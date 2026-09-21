import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl, createCodeChallenge, createCodeVerifier, createState } from './pkce.ts'

describe('PKCE', () => {
  it('creates a verifier within the RFC 7636 length and charset', () => {
    const verifier = createCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(createCodeVerifier()).not.toBe(verifier)
  })

  it('matches the RFC 7636 S256 test vector', async () => {
    await expect(createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('creates random URL-safe state', () => {
    expect(createState()).toMatch(/^[A-Za-z0-9\-_]{22}$/)
  })

  it('builds the authorize URL', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: 'http://127.0.0.1:5173/callback',
        state: 'state-1',
        codeChallenge: 'challenge-1',
        scopes: ['user-top-read', 'user-read-recently-played'],
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'http://127.0.0.1:5173/callback',
      state: 'state-1',
      code_challenge_method: 'S256',
      code_challenge: 'challenge-1',
      scope: 'user-top-read user-read-recently-played',
    })
  })
})
