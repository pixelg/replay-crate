import { buildAuthorizeUrl, createCodeChallenge, createCodeVerifier, createState } from '@replay-crate/spotify'
import { ENV } from 'varlock/env'

const STORAGE_KEY = 'replay-crate:pending-login'

type PendingLogin = { verifier: string; state: string }

/** Starts the PKCE flow: remember the verifier + state for this tab, then go to Spotify. */
export async function startSpotifyLogin(): Promise<void> {
  const pending: PendingLogin = { verifier: createCodeVerifier(), state: createState() }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending))

  window.location.assign(
    buildAuthorizeUrl({
      clientId: ENV.SPOTIFY_CLIENT_ID,
      redirectUri: ENV.SPOTIFY_REDIRECT_URI,
      state: pending.state,
      codeChallenge: await createCodeChallenge(pending.verifier),
    }),
  )
}

/** Reads and forgets the pending login, so a callback URL can only be used once. */
export function takePendingLogin(): PendingLogin | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingLogin>
    return typeof value.verifier === 'string' && typeof value.state === 'string'
      ? { verifier: value.verifier, state: value.state }
      : null
  } catch {
    return null
  }
}
