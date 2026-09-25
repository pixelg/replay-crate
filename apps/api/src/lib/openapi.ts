import { OpenAPIHono, z, type Hook } from '@hono/zod-openapi'
import type { Env } from 'hono'

/** The spec's categories. Every route has exactly one, which is also its path prefix under /api/v1. */
export const TAGS = [
  { name: 'System', description: 'Health, background jobs and the scheduled poll.' },
  { name: 'Auth', description: 'Spotify sign-in (PKCE) and the session.' },
  { name: 'History', description: 'Recorded plays, syncing them from Spotify, and gaps in the record.' },
  { name: 'Tracks', description: 'Tracks you have played, with their stats.' },
  { name: 'Playlists', description: 'Your Spotify playlists: reading, syncing, creating and editing.' },
  { name: 'Stats', description: 'Listening metrics.' },
  { name: 'Imports', description: 'Backfilling history from the Extended Streaming History export.' },
  { name: 'Player', description: 'Spotify playback: state, controls, queue and devices.' },
] as const
export type Tag = (typeof TAGS)[number]['name']

/** Session cookie (the web app) or Bearer token (native clients); see auth/session.ts. */
export const SECURITY_SCHEMES = {
  session: { type: 'apiKey', in: 'cookie', name: 'rc_session' },
  bearer: { type: 'http', scheme: 'bearer' },
} as const
/** `security` for a route behind requireUser. */
export const signedIn: Record<string, string[]>[] = [{ session: [] }, { bearer: [] }]

const errorBody = <Code extends string>(code: Code) => z.object({ error: z.literal(code) })

/**
 * Every error the API returns, by code, with the status it's sent with. Routes list the
 * codes they can return with errorResponses(); internal_error is always included.
 */
const ERRORS = {
  invalid_request: {
    status: 400,
    schema: errorBody('invalid_request')
      .extend({ issues: z.array(z.object({ path: z.string(), message: z.string() })) })
      .openapi('InvalidRequestError'),
  },
  unauthorized: { status: 401, schema: errorBody('unauthorized').openapi('UnauthorizedError') },
  forbidden: {
    status: 403,
    schema: errorBody('forbidden').extend({ message: z.string().optional() }).openapi('ForbiddenError'),
  },
  not_found: { status: 404, schema: errorBody('not_found').openapi('NotFoundError') },
  reauth_required: {
    status: 409,
    schema: errorBody('reauth_required')
      .openapi('ReauthRequiredError', { description: 'Spotify refused the refresh token; the user must reconnect.' }),
  },
  rate_limited: {
    status: 503,
    schema: errorBody('rate_limited')
      .extend({ retryAfter: z.number().int().nullable().openapi({ description: 'Seconds to wait, when Spotify said.' }) })
      .openapi('RateLimitedError'),
  },
  redirect_uri_mismatch: {
    status: 400,
    schema: errorBody('redirect_uri_mismatch').openapi('RedirectUriMismatchError', {
      description: "The login's redirect URI isn't the one this server is configured with.",
    }),
  },
  spotify_auth_failed: {
    status: 400,
    schema: errorBody('spotify_auth_failed')
      .extend({ detail: z.string().openapi({ description: "Spotify's OAuth error, e.g. invalid_grant." }) })
      .openapi('SpotifyAuthFailedError'),
  },
  missing_refresh_token: {
    status: 502,
    schema: errorBody('missing_refresh_token').openapi('MissingRefreshTokenError', {
      description: 'Spotify completed the login without a refresh token.',
    }),
  },
  cron_disabled: {
    status: 503,
    schema: errorBody('cron_disabled').openapi('CronDisabledError', { description: 'CRON_SECRET is not set.' }),
  },
  internal_error: {
    status: 500,
    schema: errorBody('internal_error')
      .extend({ requestId: z.string().openapi({ description: 'Matches X-Request-Id and the server log.' }) })
      .openapi('InternalError'),
  },
} as const

export type ErrorCode = keyof typeof ERRORS
type ErrorStatus<C extends ErrorCode> = (typeof ERRORS)[C]['status']
type CodesWithStatus<C extends ErrorCode, S> = C extends ErrorCode ? (ErrorStatus<C> extends S ? C : never) : never
type ErrorResponses<C extends ErrorCode> = {
  [S in ErrorStatus<C>]: {
    description: string
    content: { 'application/json': { schema: z.ZodType<z.output<(typeof ERRORS)[CodesWithStatus<C, S>]['schema']>> } }
  }
}

/**
 * The error half of a route's `responses`. Codes that share a status become a union.
 *
 *     responses: { 200: {...}, ...errorResponses('unauthorized', 'not_found') }
 */
export function errorResponses<const C extends Exclude<ErrorCode, 'internal_error'>>(
  ...codes: C[]
): ErrorResponses<C | 'internal_error'> {
  const byStatus = new Map<number, ErrorCode[]>()
  for (const code of [...new Set<ErrorCode>([...codes, 'internal_error'])]) {
    const { status } = ERRORS[code]
    byStatus.set(status, [...(byStatus.get(status) ?? []), code])
  }
  const responses: Record<number, unknown> = {}
  for (const [status, group] of byStatus) {
    const schemas = group.map((code) => ERRORS[code].schema)
    responses[status] = {
      description: group.join(' | '),
      content: { 'application/json': { schema: schemas.length === 1 ? schemas[0] : z.union(schemas) } },
    }
  }
  return responses as ErrorResponses<C | 'internal_error'>
}

/** The standard 400 body for failed validation. */
export function invalidRequest(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }) {
  const issues = error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
  return { error: 'invalid_request' as const, issues }
}

/** Replaces the library's default 400 (the raw zod error) with ours. */
// oxlint-disable-next-line no-explicit-any -- a hook shared by every route, whatever its input
export const defaultHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) return c.json(invalidRequest(result.error), 400)
}

/** A router whose routes are validated and documented. Each API module builds one and chains onto it. */
export function createRouter<E extends Env = Env>() {
  return new OpenAPIHono<E>({ defaultHook })
}
