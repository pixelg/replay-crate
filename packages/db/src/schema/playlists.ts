import { boolean, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { tracks } from './catalog.ts'

/**
 * Playlists a user owns or collaborates on (the only ones Spotify returns contents for).
 * Shared across users, since a collaborative playlist can be in several libraries.
 */
export const playlists = pgTable('playlists', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  ownerName: text('owner_name'),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  thumbUrl: text('thumb_url'),
  isPublic: boolean('is_public'),
  collaborative: boolean('collaborative').notNull().default(false),
  /** Spotify's version id; changes whenever the playlist changes. */
  snapshotId: text('snapshot_id').notNull(),
  /** Snapshot the stored items were fetched at. Items are re-fetched when it differs. */
  itemsSnapshotId: text('items_snapshot_id'),
  itemCount: integer('item_count').notNull().default(0),
  /** Created through Replay Crate (M5 #26/#27). */
  createdByApp: boolean('created_by_app').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

/** Which playlists are in which user's library, in their Spotify order. */
export const userPlaylists = pgTable(
  'user_playlists',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.playlistId] })],
)

/**
 * Moves made in Replay Crate that Spotify doesn't have yet, oldest first. The stored items already
 * show them (`move_playlist_item()`); a `playlist-edit` job sends them in order, and while any are
 * left the playlist's items aren't re-read from Spotify (that would undo them). `failedAt` is set
 * when Spotify refused one: the rest wait until the user retries or goes back to Spotify's order.
 */
export const playlistEdits = pgTable(
  'playlist_edits',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    /** Spotify positions, as for `PUT /playlists/{id}/items/move`. */
    fromPosition: integer('from_position').notNull(),
    toPosition: integer('to_position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [index('playlist_edits_playlist_idx').on(t.playlistId, t.id)],
)

/**
 * Tracks in a playlist. `position` is the index in Spotify's list (local files are skipped
 * but keep their slot, and episodes are in `playlist_episodes`), so positions line up for reorders.
 */
export const playlistItems = pgTable(
  'playlist_items',
  {
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    addedAt: timestamp('added_at', { withTimezone: true }),
    addedBy: text('added_by'),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.position] }), index('playlist_items_track_idx').on(t.trackId)],
)

export type Playlist = typeof playlists.$inferSelect
export type PlaylistItem = typeof playlistItems.$inferSelect
