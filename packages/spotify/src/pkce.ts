import { base64Url } from './base64url.ts'
import { SPOTIFY_ACCOUNTS_URL, SPOTIFY_SCOPES } from './constants.ts'

// PKCE helpers (RFC 7636). Web Crypto only, so they run in browsers, Node, and React Native.

/** 64-char verifier from 48 random bytes. base64url output is inside the allowed PKCE charset. */
export function createCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(48)))
}

/** S256 challenge: base64url(sha256(verifier)). */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/** Opaque value echoed back on the callback, to reject responses we didn't ask for. */
export function createState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)))
}

export function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes?: readonly string[]
}): string {
  const url = new URL('/authorize', SPOTIFY_ACCOUNTS_URL)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge_method: 'S256',
    code_challenge: params.codeChallenge,
    scope: (params.scopes ?? SPOTIFY_SCOPES).join(' '),
  }).toString()
  return url.toString()
}
