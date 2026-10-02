import { schema, type Db } from '@replay-crate/db'
import type { SpotifyContext, SpotifyPlayable } from '@replay-crate/spotify'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Whether `item` is part of the context: a track of the album, an episode of the show, or an item
 * of a playlist whose contents Replay Crate keeps (or the copy Spotify relinked it to). Null
 * when that can't be told: other playlists can't be looked into (Spotify only shows the user's
 * own), a kept playlist that changed since its items were synced may have gained it, and artists
 * and Liked Songs aren't checked.
 *
 * Spotify keeps reporting the context while items the user queued play (in playback and in
 * recently-played), and after autoplay takes over, so false means the item came from elsewhere.
 */
export async function inContext(db: Db, item: SpotifyPlayable, context: Pick<SpotifyContext, 'type' | 'uri'>): Promise<boolean | null> {
  const id = context.uri.split(':')[2]
  if (!id || !item.id) return null
  switch (context.type) {
    case 'album':
      if (item.type !== 'track') return false
      // A relinked copy can sit on another album.
      return item.album.id === id || (item.linked_from ? null : false)
    case 'show':
      return item.type === 'episode' && item.show.id === id
    case 'playlist':
      return inPlaylist(db, item, id)
    default:
      return null
  }
}

async function inPlaylist(db: Db, item: SpotifyPlayable, playlistId: string): Promise<boolean | null> {
  const { playlists, playlistItems, playlistEpisodes } = schema
  const [kept] = await db
    .select({ snapshot: playlists.snapshotId, itemsSnapshot: playlists.itemsSnapshotId })
    .from(playlists)
    .where(eq(playlists.id, playlistId))
  if (!kept?.itemsSnapshot) return null

  const [found] =
    item.type === 'track'
      ? await db
          .select({ position: playlistItems.position })
          .from(playlistItems)
          .where(and(eq(playlistItems.playlistId, playlistId), inArray(playlistItems.trackId, [item.id!, ...(item.linked_from ? [item.linked_from.id] : [])])))
          .limit(1)
      : await db
          .select({ position: playlistEpisodes.position })
          .from(playlistEpisodes)
          .where(and(eq(playlistEpisodes.playlistId, playlistId), eq(playlistEpisodes.episodeId, item.id)))
          .limit(1)
  if (found) return true
  return kept.itemsSnapshot === kept.snapshot ? false : null
}
