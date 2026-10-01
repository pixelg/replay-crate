import { schema } from '@replay-crate/db'
import { pickImage } from '@replay-crate/spotify'
import { and, eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { syncPlaylistItems } from '../sync/playlists.ts'

const { playlists, userPlaylists } = schema

/** Spotify accepts at most 100 URIs per add/remove call. */
const BATCH = 100
const DEFAULT_DESCRIPTION = 'Made with Replay Crate from your listening history.'

export class PlaylistNotEditableError extends Error {
  constructor(playlistId: string) {
    super(`Playlist ${playlistId} is not in this user's library`)
    this.name = 'PlaylistNotEditableError'
  }
}

export const trackUri = (trackId: string) => `spotify:track:${trackId}`
export const episodeUri = (episodeId: string) => `spotify:episode:${episodeId}`

// Every change goes to Spotify first, then the playlist is re-read from Spotify so the
// stored copy (positions, snapshot) always matches what Spotify actually holds.

export async function createPlaylistFor(
  deps: AppDeps,
  userId: string,
  input: { name: string; description?: string; trackIds: string[]; episodeIds?: string[] },
): Promise<{ id: string }> {
  const { db, spotify } = deps
  const accessToken = await getAccessToken(deps, userId)

  const created = await spotify.createPlaylist(accessToken, {
    name: input.name,
    description: input.description ?? DEFAULT_DESCRIPTION,
    // Asked for, but Spotify currently makes app-created playlists public regardless (checked
    // Sep 2026; Change Playlist Details ignores it too). Users can switch it in the Spotify app.
    public: false,
  })
  await db
    .insert(playlists)
    .values({
      id: created.id,
      ownerId: userId,
      ownerName: created.owner.display_name,
      name: created.name,
      description: created.description || null,
      imageUrl: pickImage(created.images, 300),
      thumbUrl: pickImage(created.images, 64),
      isPublic: created.public,
      collaborative: created.collaborative,
      snapshotId: created.snapshot_id,
      createdByApp: true,
    })
    .onConflictDoNothing()
  // Spotify puts new playlists at the top of the library; the next sync sets the real order.
  await db.insert(userPlaylists).values({ userId, playlistId: created.id, position: -1 }).onConflictDoNothing()

  let snapshotId = created.snapshot_id
  const all = [...input.trackIds.map(trackUri), ...(input.episodeIds ?? []).map(episodeUri)]
  for (let i = 0; i < all.length; i += BATCH) {
    snapshotId = (await spotify.addPlaylistItems(accessToken, created.id, all.slice(i, i + BATCH))).snapshot_id
  }
  await syncPlaylistItems(deps, accessToken, created.id, snapshotId)
  return { id: created.id }
}

/** Adds tracks or episodes (by Spotify URI), appended or at `position`. */
export async function addItems(
  deps: AppDeps,
  userId: string,
  playlistId: string,
  itemUris: string[],
  position?: number,
): Promise<void> {
  await requireInLibrary(deps, userId, playlistId)
  const accessToken = await getAccessToken(deps, userId)

  let snapshotId = ''
  for (let i = 0; i < itemUris.length; i += BATCH) {
    const uris = itemUris.slice(i, i + BATCH)
    // Keep a batch insert contiguous when inserting at a position.
    const at = position === undefined ? undefined : position + i
    snapshotId = (await deps.spotify.addPlaylistItems(accessToken, playlistId, uris, at)).snapshot_id
  }
  await syncPlaylistItems(deps, accessToken, playlistId, snapshotId)
}

export const addTracks = (deps: AppDeps, userId: string, playlistId: string, trackIds: string[], position?: number) =>
  addItems(deps, userId, playlistId, trackIds.map(trackUri), position)

/** Removes every occurrence of each track or episode (Spotify's remove works by URI, not position). */
export async function removeItems(deps: AppDeps, userId: string, playlistId: string, itemUris: string[]): Promise<void> {
  await requireInLibrary(deps, userId, playlistId)
  const accessToken = await getAccessToken(deps, userId)

  let snapshotId = ''
  for (let i = 0; i < itemUris.length; i += BATCH) {
    const uris = itemUris.slice(i, i + BATCH)
    snapshotId = (await deps.spotify.removePlaylistItems(accessToken, playlistId, uris)).snapshot_id
  }
  await syncPlaylistItems(deps, accessToken, playlistId, snapshotId)
}

export const removeTracks = (deps: AppDeps, userId: string, playlistId: string, trackIds: string[]) =>
  removeItems(deps, userId, playlistId, trackIds.map(trackUri))

/** Moves the item at `from` so it ends up at index `to` (both are Spotify positions). */
export async function moveTrack(deps: AppDeps, userId: string, playlistId: string, from: number, to: number): Promise<void> {
  const playlist = await requireInLibrary(deps, userId, playlistId)
  if (from === to) return
  const accessToken = await getAccessToken(deps, userId)

  // Spotify inserts *before* an index of the original list, so moving down targets to + 1.
  const insertBefore = to > from ? to + 1 : to
  const { snapshot_id } = await deps.spotify.reorderPlaylistItems(accessToken, playlistId, {
    rangeStart: from,
    insertBefore,
    // The version our stored positions came from, so Spotify applies the move to the list
    // the user was looking at even if the playlist changed since.
    snapshotId: playlist.itemsSnapshotId ?? undefined,
  })
  await syncPlaylistItems(deps, accessToken, playlistId, snapshot_id)
}

async function requireInLibrary(deps: AppDeps, userId: string, playlistId: string) {
  const [row] = await deps.db
    .select({ itemsSnapshotId: playlists.itemsSnapshotId })
    .from(playlists)
    .innerJoin(userPlaylists, and(eq(userPlaylists.playlistId, playlists.id), eq(userPlaylists.userId, userId)))
    .where(eq(playlists.id, playlistId))
  if (!row) throw new PlaylistNotEditableError(playlistId)
  return row
}
