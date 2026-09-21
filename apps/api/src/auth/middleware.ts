import type { User } from '@replay-crate/db'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppDeps } from '../deps.ts'
import { readSessionToken, setSessionCookie, validateSession } from './session.ts'

/** Resolves the signed-in user from the cookie or Bearer token, renewing the cookie if due. */
export async function authenticate(c: Context, deps: AppDeps): Promise<User | null> {
  const credentials = readSessionToken(c)
  if (!credentials) return null
  const session = await validateSession(deps.db, credentials.token, deps.now?.() ?? new Date())
  if (!session) return null

  if (session.renewed && credentials.via === 'cookie') {
    const secure = new URL(deps.redirectUri).protocol === 'https:'
    setSessionCookie(c, credentials.token, session.expiresAt, secure)
  }
  return session.user
}

/** Rejects the request with 401 unless there's a valid session; exposes `c.var.user`. */
export function requireUser(deps: AppDeps) {
  return createMiddleware<{ Variables: { user: User } }>(async (c, next) => {
    const user = await authenticate(c, deps)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    c.set('user', user)
    await next()
  })
}
