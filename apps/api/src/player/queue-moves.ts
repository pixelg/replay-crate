import { schema, type Db } from '@replay-crate/db'
import type { SpotifyPlaybackState, SpotifyPlayable } from '@replay-crate/spotify'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { saveMove, sendPendingMoves } from '../playlists/edits.ts'

// Reordering Up next. Spotify has no call for it, and replaying the queue as bare URIs stops an
// iPhone dead (see play-item.ts). But while one of the user's playlists plays in order, most of Up
// next is the rest of that playlist: moving a row there moves it in the playlist, which Spotify's
// player follows. Items the user queued (listed first) and anything past the playlist's end (a
// repeat starting over) aren't the playlist's, and stay where they are.

export type UpNextPlaylist = {
  id: string
  name: string
  /** Each Up next item's position in the playlist, or null for one that isn't the playlist's next items. */
  positions: (number | null)[]
}

/** Spotify's own id for an item, and the one the playlist holds when Spotify relinked it. */
const urisOf = (item: SpotifyPlayable) => [item.uri, ...(item.type === 'track' && item.linked_from?.uri ? [item.linked_from.uri] : [])]

/**
 * Which of Up next is the rest of the playing playlist, by position: null unless one of the user's
 * playlists (whose items Replay Crate keeps) plays with shuffle off. Spotify lists the user's own
 * queue first, so the playlist's part is the longest tail of `queue` that runs through the
 * playlist in order, up to the end of either.
 */
export async function upNextInPlaylist(
  db: Db,
  userId: string,
  state: Pick<SpotifyPlaybackState, 'context' | 'shuffle_state'> | null,
  queue: SpotifyPlayable[],
): Promise<UpNextPlaylist | null> {
  const context = state?.context
  if (!context || context.type !== 'playlist' || state.shuffle_state || !queue.length) return null
  const playlistId = context.uri.split(':')[2]
  if (!playlistId) return null
  const { playlists, userPlaylists } = schema
  const [playlist] = await db
    .select({ name: playlists.name })
    .from(playlists)
    .innerJoin(userPlaylists, and(eq(userPlaylists.playlistId, playlists.id), eq(userPlaylists.userId, userId)))
    .where(and(eq(playlists.id, playlistId), isNotNull(playlists.itemsSnapshotId)))
  if (!playlist) return null

  const entries = (
    (await db.execute(sql`
      select position, 'spotify:track:' || track_id as uri from playlist_items where playlist_id = ${playlistId}
      union all
      select position, 'spotify:episode:' || episode_id from playlist_episodes where playlist_id = ${playlistId}
      order by position`)) as unknown as { rows: { position: number; uri: string }[] }
  ).rows
  const matches = (q: number, e: number) => urisOf(queue[q]!).includes(entries[e]!.uri)

  for (let start = 0; start < queue.length; start++) {
    for (let e = 0; e < entries.length; e++) {
      if (!matches(start, e)) continue
      let run = 1
      while (start + run < queue.length && e + run < entries.length && matches(start + run, e + run)) run++
      // The run has to reach the end of Up next, or the end of the playlist (a repeat starting over).
      if (start + run < queue.length && e + run < entries.length) continue
      const positions = queue.map((_, q) => (q >= start && q < start + run ? entries[e + q - start]!.position : null))
      return { id: playlistId, name: playlist.name, positions }
    }
  }
  return null
}

/**
 * Moves the Up next item at `index` to where the one at `toIndex` is, by moving it in the playing
 * playlist: saved at once and sent to Spotify straight away (its job sends it if that fails).
 * 'missing' when Up next has changed, or either row isn't the playlist's.
 */
export async function moveInUpNext(
  deps: AppDeps,
  userId: string,
  token: string,
  { uri, index, toIndex }: { uri: string; index: number; toIndex: number },
): Promise<{ playlistId: string } | 'missing'> {
  const [state, { queue }] = await Promise.all([deps.spotify.getPlaybackState(token), deps.spotify.getQueue(token)])
  const playlist = await upNextInPlaylist(deps.db, userId, state, queue)
  if (!playlist || queue[index]?.uri !== uri) return 'missing'
  const from = playlist.positions[index]
  const to = playlist.positions[toIndex]
  if (from == null || to == null) return 'missing'
  await saveMove(deps, userId, playlist.id, from, to)
  await sendPendingMoves(deps, userId, playlist.id, token, { wait: false }).catch((error: unknown) =>
    console.warn(`[player] moving in Up next: Spotify didn't take it yet (its job will retry):`, error),
  )
  return { playlistId: playlist.id }
}
