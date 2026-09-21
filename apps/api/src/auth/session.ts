import { schema, type Db } from '@replay-crate/db'
import { and, eq, gt, lte } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createSessionToken, hashSessionToken } from '../lib/crypto.ts'

const { sessions, users } = schema

export const SESSION_COOKIE = 'rc_session'
const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 30 * DAY_MS
/** Sessions slide forward once less than this much time is left. */
const RENEW_WITHIN_MS = 15 * DAY_MS

export async function createSession(db: Db, userId: string, now: Date) {
  const token = createSessionToken()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, now)))
  await db.insert(sessions).values({ id: await hashSessionToken(token), userId, expiresAt })
  return { token, expiresAt }
}

export async function validateSession(db: Db, token: string, now: Date) {
  const id = await hashSessionToken(token)
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
  if (!row) return null

  if (row.expiresAt.getTime() - now.getTime() < RENEW_WITHIN_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id))
    return { user: row.user, expiresAt, renewed: true }
  }
  return { user: row.user, expiresAt: row.expiresAt, renewed: false }
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, await hashSessionToken(token)))
}

/** Browsers send the cookie; native clients (the future RN app) send `Authorization: Bearer`. */
export function readSessionToken(c: Context): { token: string; via: 'cookie' | 'bearer' } | null {
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) return { token: header.slice('Bearer '.length), via: 'bearer' }
  const cookie = getCookie(c, SESSION_COOKIE)
  return cookie ? { token: cookie, via: 'cookie' } : null
}

export function setSessionCookie(c: Context, token: string, expiresAt: Date, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', expires: expiresAt })
}

export function clearSessionCookie(c: Context, secure: boolean) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure })
}
