import { parseSpotifyUri } from '@replay-crate/core'
import { schema } from '@replay-crate/db'
import { pickImage, SpotifyApiError, type SpotifyContext } from '@replay-crate/spotify'
import { eq, inArray } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'

const { albums, artists, contexts } = schema

/** Cap on Spotify lookups per sync; anything left over resolves on the next one. */
const MAX_LOOKUPS_PER_SYNC = 10

type Resolved = { name: string | null; imageUrl: string | null }

/**
 * Stores a display name + image for each context URI we haven't seen before. Contexts
 * Spotify refuses to describe (404/403) are stored nameless so we don't ask again.
 */
export async function resolveContexts(deps: AppDeps, accessToken: string, playContexts: SpotifyContext[]) {
  const { db } = deps
  const byUri = new Map(playContexts.map((context) => [context.uri, context]))
  if (!byUri.size) return

  const known = await db.select({ uri: contexts.uri }).from(contexts).where(inArray(contexts.uri, [...byUri.keys()]))
  for (const { uri } of known) byUri.delete(uri)

  for (const context of [...byUri.values()].slice(0, MAX_LOOKUPS_PER_SYNC)) {
    let resolved: Resolved
    try {
      resolved = await describe(deps, accessToken, context)
    } catch (error) {
      if (error instanceof SpotifyApiError && [400, 403, 404].includes(error.status)) {
        resolved = { name: null, imageUrl: null }
      } else {
        continue // transient (rate limit, 5xx): try again next sync
      }
    }
    await db
      .insert(contexts)
      .values({ uri: context.uri, type: context.type, ...resolved })
      .onConflictDoNothing()
  }
}

async function describe(deps: AppDeps, accessToken: string, context: SpotifyContext): Promise<Resolved> {
  const { db, spotify } = deps
  const parsed = parseSpotifyUri(context.uri)
  if (!parsed) return { name: null, imageUrl: null }

  switch (parsed.type) {
    case 'collection':
      return { name: 'Liked Songs', imageUrl: null }

    case 'playlist': {
      const playlist = await spotify.getPlaylistMeta(accessToken, parsed.id)
      return { name: playlist.name, imageUrl: pickImage(playlist.images, 300) }
    }

    case 'album': {
      const [album] = await db.select().from(albums).where(eq(albums.id, parsed.id))
      if (album) return { name: album.name, imageUrl: album.imageUrl }
      const fetched = await spotify.getAlbum(accessToken, parsed.id)
      return { name: fetched.name, imageUrl: pickImage(fetched.images, 300) }
    }

    case 'artist': {
      const fetched = await spotify.getArtist(accessToken, parsed.id)
      const imageUrl = pickImage(fetched.images, 300)
      // Simplified artist objects in plays carry no image, so keep this one.
      await db.update(artists).set({ imageUrl }).where(eq(artists.id, parsed.id))
      return { name: fetched.name, imageUrl }
    }

    default:
      return { name: null, imageUrl: null }
  }
}
