import { isApiError } from '@replay-crate/api-client'
import { isNotFound } from '@tanstack/react-router'
import { LoginProblem } from './login-problem.ts'

export type ErrorKind =
  | 'offline'
  | 'server'
  | 'rate_limited'
  | 'signed_out'
  | 'reauth'
  | 'not_found'
  | 'login'
  | 'app'

/** What the error page's main button does. */
export type ErrorAction = 'retry' | 'reload' | 'sign_in' | 'reconnect' | 'home'

export type ErrorDescription = {
  kind: ErrorKind
  /** `api`: the server said no or didn't answer. `app`: a bug or problem in the web app itself. */
  source: 'api' | 'app'
  title: string
  message: string
  action: ErrorAction
  /** Shareable reference for server errors (the request id in the API log). */
  reference: string | null
  /** Technical detail, shown in development builds only. */
  details: string | null
}

/** Turns anything thrown into what the UI should say and offer. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof LoginProblem) {
    return {
      kind: 'login',
      source: 'app',
      title: "Couldn't connect Spotify",
      message: error.message,
      action: 'reconnect',
      reference: null,
      details: null,
    }
  }

  if (isNotFound(error)) {
    return {
      kind: 'not_found',
      source: 'app',
      title: 'Page not found',
      message: "There's nothing at this address.",
      action: 'home',
      reference: null,
      details: null,
    }
  }

  if (isApiError(error)) {
    const api = (kind: ErrorKind, title: string, message: string, action: ErrorAction): ErrorDescription => ({
      kind,
      source: 'api',
      title,
      message,
      action,
      reference: error.requestId,
      details: `${error.endpoint} → ${error.status || 'no response'} ${error.code}`,
    })

    if (error.status === 401) {
      return api('signed_out', "You've been signed out", 'Your session ended. Sign in again to pick up where you left off.', 'sign_in')
    }
    if (error.code === 'reauth_required') {
      return api('reauth', 'Spotify access expired', 'Reconnect Spotify so Replay Crate can keep recording your plays.', 'reconnect')
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      const wait = error.retryAfter ? `in ${error.retryAfter} seconds` : 'in a minute'
      return api('rate_limited', 'Spotify needs a breather', `Spotify is limiting requests right now. Try again ${wait}.`, 'retry')
    }
    if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) {
      return api(
        'offline',
        "Can't reach Replay Crate",
        "The server didn't answer. Check your connection, or that the API is running, then try again.",
        'retry',
      )
    }
    if (error.status === 404) {
      return api('not_found', 'Not found', "This doesn't exist, or it isn't in your library.", 'home')
    }
    return api(
      'server',
      'Something went wrong on the server',
      'The request failed. It has been logged, so trying again may be all it takes.',
      'retry',
    )
  }

  // Anything else is a bug in the web app itself.
  return {
    kind: 'app',
    source: 'app',
    title: 'Something broke in the app',
    message: "That's a bug on our side. Reloading the page usually gets things going again.",
    action: 'reload',
    reference: null,
    details: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }
}
