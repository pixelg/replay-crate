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
 * Tracks in a playlist. `position` is the index in Spotify's list (local files and
 * episodes are skipped but keep their slot), so positions line up for reorders.
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
