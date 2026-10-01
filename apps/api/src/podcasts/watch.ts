import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { missingScopes } from '../auth/me.ts'
import type { AppDeps } from '../deps.ts'
import { pausedUntil, pauseSpotify } from '../jobs/budget.ts'
import { holdLease, PROCESS_ID, releaseLease } from '../jobs/lease.ts'
import { getAccessToken, ReauthRequiredError } from '../spotify/access-token.ts'
import { recordObservation } from './listens.ts'

/** Only the process holding this lease watches the players. */
export const WATCH_LEASE = 'player-watch'

type Logger = Pick<Console, 'info' | 'error'>

export type WatchResult = { userId: string; outcome: 'recorded' | 'skipped' | 'reauth_required' | 'failed' }

/**
 * Looks at every connected user's player once and records what it shows (see
 * `recordObservation`). Users the app looked at within `freshMs` are skipped: the app's own polls
 * are recording them. A 429 pauses Spotify's background calls for every process and ends the round.
 */
export async function watchAllUsers(deps: AppDeps, { freshMs }: { freshMs: number }): Promise<WatchResult[]> {
  const now = () => deps.now?.() ?? new Date()
  const users = await deps.db
    .select({ id: schema.users.id, scope: schema.users.scope, observedAt: schema.playerWatch.observedAt })
    .from(schema.users)
    .leftJoin(schema.playerWatch, eq(schema.playerWatch.userId, schema.users.id))
    .where(eq(schema.users.needsReauth, false))

  const results: WatchResult[] = []
  for (const user of users) {
    // Connected before the player existed: nothing to look at until they reconnect.
    if (missingScopes(user.scope).includes('user-read-playback-state')) continue
    if (user.observedAt && now().getTime() - user.observedAt.getTime() < freshMs) {
      results.push({ userId: user.id, outcome: 'skipped' })
      continue
    }
    try {
      const state = await deps.spotify.getPlaybackState(await getAccessToken(deps, user.id))
      const recorded = await recordObservation(deps.db, user.id, state, now())
      results.push({ userId: user.id, outcome: recorded ? 'recorded' : 'skipped' })
    } catch (error) {
      if (error instanceof ReauthRequiredError) {
        results.push({ userId: user.id, outcome: 'reauth_required' })
        continue
      }
      console.error(`[watch] looking at ${user.id}'s player failed`, error)
      results.push({ userId: user.id, outcome: 'failed' })
      if (error instanceof SpotifyApiError && error.status === 429) {
        await pauseSpotify(deps.db, new Date(now().getTime() + (error.retryAfter ?? 60) * 1000), now())
        break
      }
    }
  }
  return results
}

/**
 * Runs `watchAllUsers` every `intervalMs` while the API is up, so episode listens are recorded
 * with no browser open (Spotify's recently-played leaves episodes out). Like the sync scheduler it
 * holds a lease, so with `pnpm dev` and the serve service both up only one process watches, waits
 * out Spotify's Retry-After, and never overlaps a slow round. Returns a function that stops it.
 */
export function startPlayerWatch(
  deps: AppDeps,
  {
    intervalMs,
    firstRunAfterMs = 10_000,
    holder = PROCESS_ID,
    log = console,
  }: { intervalMs: number; firstRunAfterMs?: number; holder?: string; log?: Logger },
): () => void {
  let running = false
  let holding: boolean | undefined

  async function tick() {
    if (running) return
    running = true
    try {
      const now = deps.now?.() ?? new Date()
      const held = await holdLease(deps.db, WATCH_LEASE, holder, intervalMs * 2, now)
      if (held !== holding && !held) log.info('[watch] another process watches the players; standing by')
      holding = held
      if (!held || (await pausedUntil(deps.db, now))) return
      // The app polls every few seconds while it's open; a look it took this recently means it's still there.
      await watchAllUsers(deps, { freshMs: intervalMs * 0.75 })
    } catch (error) {
      log.error('[watch] watching the players failed', error)
    } finally {
      running = false
    }
  }

  const first = setTimeout(tick, firstRunAfterMs)
  const timer = setInterval(tick, intervalMs)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    if (holding) void releaseLease(deps.db, WATCH_LEASE, holder).catch(() => {})
  }
}
