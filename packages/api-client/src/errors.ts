import type { ClientResponse } from 'hono/client'
import type { SuccessStatusCode } from 'hono/utils/http-status'

/** The parts of a response an error needs; both fetch's Response and Hono's ClientResponse fit. */
type ResponseLike = { status: number; headers: Headers; json(): Promise<unknown> }

/**
 * Any failed API call: an HTTP error response, or no response at all (`status` 0, e.g.
 * the server is down or the device is offline). Anything else thrown in the app is a
 * bug in the app itself, which the UI treats differently.
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number
  /** The API's `error` code, e.g. `not_found`, `reauth_required`, `network_error`. */
  readonly code: string
  /** From the X-Request-Id header; matches the server log. */
  readonly requestId: string | null
  /** e.g. `GET /api/v1/history/plays`. */
  readonly endpoint: string
  /** Seconds to wait, for rate limits. */
  readonly retryAfter: number | null
  /** Spotify's reason when the player refused a command (`command_refused`), e.g. VOLUME_CONTROL_DISALLOW. */
  readonly reason: string | null

  constructor(init: {
    status: number
    code: string
    endpoint: string
    requestId?: string | null
    retryAfter?: number | null
    reason?: string | null
    cause?: unknown
  }) {
    super(`${init.endpoint} failed: ${init.status || 'no response'} ${init.code}`, { cause: init.cause })
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.endpoint = init.endpoint
    this.requestId = init.requestId ?? null
    this.retryAfter = init.retryAfter ?? null
    this.reason = init.reason ?? null
  }

  /** Builds an ApiError from an error response's JSON body (`{ error, retryAfter?, requestId? }`). */
  static async fromResponse(res: ResponseLike, endpoint: string): Promise<ApiError> {
    const body = (await res.json().catch(() => ({}))) as {
      error?: unknown
      retryAfter?: unknown
      requestId?: unknown
      reason?: unknown
    }
    return new ApiError({
      status: res.status,
      code: typeof body.error === 'string' ? body.error : `http_${res.status}`,
      endpoint,
      requestId: res.headers.get('X-Request-Id') ?? (typeof body.requestId === 'string' ? body.requestId : null),
      retryAfter: typeof body.retryAfter === 'number' ? body.retryAfter : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
    })
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status)
}

/** Runs a request, turning "no response" (fetch rejects) into an ApiError. */
export async function send<T>(endpoint: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (cause) {
    throw new ApiError({ status: 0, code: 'network_error', endpoint, cause })
  }
}

/** The body type of the 2xx members of a typed Hono response union. */
type OkBody<R> = R extends ClientResponse<infer Body, infer Status, 'json'>
  ? Status extends SuccessStatusCode
    ? Body
    : never
  : never

/** Returns the JSON body of a 2xx response, or throws its ApiError. */
export async function expectOk<R extends ClientResponse<unknown, number, string>>(
  res: R,
  endpoint: string,
): Promise<OkBody<R>> {
  if (!res.ok) throw await ApiError.fromResponse(res, endpoint)
  return (await res.json()) as OkBody<R>
}
