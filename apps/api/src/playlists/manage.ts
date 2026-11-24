import { schema } from '@replay-crate/db'
import { pickImage } from '@replay-crate/spotify'
import { and, eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { syncPlaylistItems } from '../sync/playlists.ts'
import { discardMoves, retryMoves, saveMove, sendPendingMoves } from './edits.ts'

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

// Adding and removing go to Spotify first, then the playlist is re-read from Spotify so the
// stored copy (positions, snapshot) matches what Spotify actually holds. Moves are saved here
// first and sent after (`edits.ts`); any still unsent go to Spotify before another change.

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
  await sendPendingMoves(deps, userId, playlistId, accessToken)

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
  await sendPendingMoves(deps, userId, playlistId, accessToken)

  let snapshotId = ''
  for (let i = 0; i < itemUris.length; i += BATCH) {
    const uris = itemUris.slice(i, i + BATCH)
    snapshotId = (await deps.spotify.removePlaylistItems(accessToken, playlistId, uris)).snapshot_id
  }
  await syncPlaylistItems(deps, accessToken, playlistId, snapshotId)
}

export const removeTracks = (deps: AppDeps, userId: string, playlistId: string, trackIds: string[]) =>
  removeItems(deps, userId, playlistId, trackIds.map(trackUri))

/** Moves the item at `from` so it ends up at index `to` (both are Spotify positions): saved now, sent to Spotify after. */
export async function moveItem(deps: AppDeps, userId: string, playlistId: string, from: number, to: number): Promise<void> {
  await requireInLibrary(deps, userId, playlistId)
  await saveMove(deps, userId, playlistId, from, to)
}

/** Sends the moves Spotify refused again. */
export async function retryUnsentMoves(deps: AppDeps, userId: string, playlistId: string): Promise<void> {
  await requireInLibrary(deps, userId, playlistId)
  await retryMoves(deps, userId, playlistId)
}

/** Drops the moves Spotify doesn't have and takes Spotify's order back. */
export async function discardUnsentMoves(deps: AppDeps, userId: string, playlistId: string): Promise<void> {
  await requireInLibrary(deps, userId, playlistId)
  await discardMoves(deps.db, userId, playlistId)
  await syncPlaylistItems(deps, await getAccessToken(deps, userId), playlistId)
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
