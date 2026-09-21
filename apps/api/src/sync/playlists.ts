import { schema } from '@replay-crate/db'
import { pickImage, SpotifyApiError, type Paging, type SpotifyPlaylist, type SpotifyTrack } from '@replay-crate/spotify'
import { and, eq, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { upsertCatalog } from './catalog.ts'

const { playlistItems, playlists, userPlaylists, users } = schema

export type PlaylistSyncResult = {
  /** Playlists the user owns or collaborates on. */
  total: number
  /** Playlists whose tracks were (re)fetched in this call. */
  synced: number
  /** Playlists still waiting for their tracks; call again to continue. */
  remaining: number
}

/** Stop starting new playlists after this long, so one call fits a serverless timeout. */
const DEFAULT_TIME_BUDGET_MS = 20_000
const CHUNK = 500

/**
 * Syncs the user's playlists: metadata for all of them, then tracks for each playlist whose
 * Spotify snapshot changed since we last looked, until the time budget runs out.
 */
export async function syncPlaylists(
  deps: AppDeps,
  userId: string,
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS } = {},
): Promise<PlaylistSyncResult> {
  const { db, spotify } = deps
  const startedAt = Date.now()
  const accessToken = await getAccessToken(deps, userId)

  const library = await fetchAll((offset) => spotify.getMyPlaylists(accessToken, offset))
  // Spotify only returns contents for playlists the user owns or collaborates on.
  const mine = library.filter((playlist) => playlist && (playlist.owner.id === userId || playlist.collaborative))

  if (mine.length) {
    await db
      .insert(playlists)
      .values(mine.map(toPlaylistRow))
      .onConflictDoUpdate({
        target: playlists.id,
        set: {
          ownerId: sql`excluded.owner_id`,
          ownerName: sql`excluded.owner_name`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          imageUrl: sql`excluded.image_url`,
          thumbUrl: sql`excluded.thumb_url`,
          isPublic: sql`excluded.is_public`,
          collaborative: sql`excluded.collaborative`,
          snapshotId: sql`excluded.snapshot_id`,
          itemCount: sql`excluded.item_count`,
          updatedAt: sql`now()`,
        },
      })
    await db
      .insert(userPlaylists)
      .values(mine.map((playlist, position) => ({ userId, playlistId: playlist.id, position })))
      .onConflictDoUpdate({
        target: [userPlaylists.userId, userPlaylists.playlistId],
        set: { position: sql`excluded.position` },
      })
  }
  // Forget playlists the user deleted or unfollowed.
  await db
    .delete(userPlaylists)
    .where(
      and(
        eq(userPlaylists.userId, userId),
        mine.length ? notInArray(userPlaylists.playlistId, mine.map((playlist) => playlist.id)) : undefined,
      ),
    )

  const stale = await db
    .select({ id: playlists.id, snapshotId: playlists.snapshotId })
    .from(playlists)
    .innerJoin(userPlaylists, eq(userPlaylists.playlistId, playlists.id))
    .where(
      and(
        eq(userPlaylists.userId, userId),
        or(isNull(playlists.itemsSnapshotId), ne(playlists.itemsSnapshotId, playlists.snapshotId)),
      ),
    )
    .orderBy(userPlaylists.position)

  let synced = 0
  let dropped = 0
  for (const playlist of stale) {
    if (Date.now() - startedAt > timeBudgetMs) break
    try {
      await syncPlaylistItems(deps, accessToken, playlist.id, playlist.snapshotId)
      synced++
    } catch (error) {
      // Not (or no longer) a collaborator, or deleted since we listed it.
      if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) {
        await db
          .delete(userPlaylists)
          .where(and(eq(userPlaylists.userId, userId), eq(userPlaylists.playlistId, playlist.id)))
        dropped++
        continue
      }
      throw error
    }
  }

  const remaining = stale.length - synced - dropped
  if (remaining === 0) {
    await db
      .update(users)
      .set({ playlistsSyncedAt: deps.now?.() ?? new Date() })
      .where(eq(users.id, userId))
  }
  return { total: mine.length - dropped, synced, remaining }
}

async function syncPlaylistItems(deps: AppDeps, accessToken: string, playlistId: string, snapshotId: string) {
  const { db, spotify } = deps
  const entries = await fetchAll((offset) => spotify.getPlaylistItems(accessToken, playlistId, offset))

  // Keep each entry's index so positions match Spotify's, even with skipped local files/episodes.
  const trackEntries = entries.flatMap((entry, position) => {
    const item = entry.item
    if (!item || item.type === 'episode' || entry.is_local) return []
    const track = item as SpotifyTrack
    return track.id ? [{ entry, track, position }] : []
  })

  for (let i = 0; i < trackEntries.length; i += CHUNK) {
    await upsertCatalog(
      db,
      trackEntries.slice(i, i + CHUNK).map(({ track }) => track),
    )
  }

  // Replace the stored items. Not atomic (Neon HTTP has no transactions), but the snapshot
  // marker is only written last, so an interrupted sync is simply redone next time.
  await db.delete(playlistItems).where(eq(playlistItems.playlistId, playlistId))
  for (let i = 0; i < trackEntries.length; i += CHUNK) {
    await db.insert(playlistItems).values(
      trackEntries.slice(i, i + CHUNK).map(({ entry, track, position }) => ({
        playlistId,
        position,
        trackId: track.id!,
        addedAt: entry.added_at ? new Date(entry.added_at) : null,
        addedBy: entry.added_by?.id ?? null,
      })),
    )
  }
  await db.update(playlists).set({ itemsSnapshotId: snapshotId }).where(eq(playlists.id, playlistId))
}

function toPlaylistRow(playlist: SpotifyPlaylist) {
  return {
    id: playlist.id,
    ownerId: playlist.owner.id,
    ownerName: playlist.owner.display_name,
    name: playlist.name,
    description: playlist.description || null,
    imageUrl: pickImage(playlist.images, 300),
    thumbUrl: pickImage(playlist.images, 64),
    isPublic: playlist.public,
    collaborative: playlist.collaborative,
    snapshotId: playlist.snapshot_id,
    itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
  }
}

/** Follows offset pagination until Spotify says there's no next page. */
async function fetchAll<T>(fetchPage: (offset: number) => Promise<Paging<T>>): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; ) {
    const page = await fetchPage(offset)
    all.push(...page.items)
    offset += page.items.length
    if (!page.next || !page.items.length) return all
  }
}
