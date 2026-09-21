import { schema, type Db } from '@replay-crate/db'
import { pickImage, type SpotifySimplifiedArtist, type SpotifyTrack } from '@replay-crate/spotify'
import { sql } from 'drizzle-orm'

const { albumArtists, albums, artists, trackArtists, tracks } = schema

/**
 * Upserts the artists, albums and tracks behind `items`, parents first so foreign keys
 * hold. Every statement is idempotent, so a failed run is simply completed by the next.
 */
export async function upsertCatalog(db: Db, items: SpotifyTrack[]): Promise<void> {
  const catalogTracks = uniqueBy(
    items.filter((track): track is SpotifyTrack & { id: string } => track.id != null && !track.is_local),
    (track) => track.id,
  )
  if (!catalogTracks.length) return

  const allArtists = uniqueBy(
    catalogTracks.flatMap((track) => [...track.artists, ...track.album.artists]).filter(hasId),
    (artist) => artist.id,
  )
  await db
    .insert(artists)
    .values(allArtists.map((artist) => ({ id: artist.id, name: artist.name })))
    .onConflictDoUpdate({ target: artists.id, set: { name: sql`excluded.name`, updatedAt: sql`now()` } })

  const allAlbums = uniqueBy(
    catalogTracks.map((track) => track.album),
    (album) => album.id,
  )
  await db
    .insert(albums)
    .values(
      allAlbums.map((album) => ({
        id: album.id,
        name: album.name,
        albumType: album.album_type,
        releaseDate: album.release_date || null,
        imageUrl: pickImage(album.images, 300),
        thumbUrl: pickImage(album.images, 64),
      })),
    )
    .onConflictDoUpdate({
      target: albums.id,
      set: {
        name: sql`excluded.name`,
        albumType: sql`excluded.album_type`,
        releaseDate: sql`excluded.release_date`,
        imageUrl: sql`excluded.image_url`,
        thumbUrl: sql`excluded.thumb_url`,
        updatedAt: sql`now()`,
      },
    })

  const albumCredits = allAlbums.flatMap((album) =>
    album.artists.filter(hasId).map((artist, position) => ({ albumId: album.id, artistId: artist.id, position })),
  )
  if (albumCredits.length) await db.insert(albumArtists).values(albumCredits).onConflictDoNothing()

  await db
    .insert(tracks)
    .values(
      catalogTracks.map((track) => ({
        id: track.id,
        name: track.name,
        albumId: track.album.id,
        durationMs: track.duration_ms,
        explicit: track.explicit,
        isrc: track.external_ids?.isrc ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: tracks.id,
      set: {
        name: sql`excluded.name`,
        albumId: sql`excluded.album_id`,
        durationMs: sql`excluded.duration_ms`,
        explicit: sql`excluded.explicit`,
        isrc: sql`excluded.isrc`,
        updatedAt: sql`now()`,
      },
    })

  const trackCredits = catalogTracks.flatMap((track) =>
    track.artists.filter(hasId).map((artist, position) => ({ trackId: track.id, artistId: artist.id, position })),
  )
  if (trackCredits.length) await db.insert(trackArtists).values(trackCredits).onConflictDoNothing()
}

function hasId(artist: SpotifySimplifiedArtist): boolean {
  return Boolean(artist.id)
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}
