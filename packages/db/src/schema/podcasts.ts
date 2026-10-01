import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, integer, pgTable, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { playlists } from './playlists.ts'
import { playSource } from './plays.ts'

// Podcasts, apart from the music catalog and plays so nothing about music changes. Spotify's
// recently-played never lists episodes: listens come from polling the player (see `mergeListen`
// in packages/core) and from the streaming-history import.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const shows = pgTable('shows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  /** ~300px, for detail views. */
  imageUrl: text('image_url'),
  /** ~64px, for list rows. */
  thumbUrl: text('thumb_url'),
  /** When its latest episodes were last fetched (followed shows only). */
  episodesCheckedAt: timestamp('episodes_checked_at', { withTimezone: true }),
  ...timestamps,
})

export const episodes = pgTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id),
    name: text('name').notNull(),
    /** Plain text, cut short (see `upsertEpisodes`). */
    description: text('description'),
    durationMs: integer('duration_ms').notNull(),
    /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; null until the episode has been looked up (the player leaves it out). */
    releaseDate: text('release_date'),
    explicit: boolean('explicit').notNull().default(false),
    imageUrl: text('image_url'),
    thumbUrl: text('thumb_url'),
    ...timestamps,
  },
  (t) => [index('episodes_show_release_idx').on(t.showId, t.releaseDate)],
)

/**
 * One stretch of listening to an episode. Polled listens grow as the player is seen moving along
 * (`lastSeenAt` and `endPositionMs` are where it was last seen); imported ones arrive whole, with
 * no positions. Times are the episode's own, so a listen at 2× is half as long on the clock.
 */
export const episodeListens = pgTable(
  'episode_listens',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** When it last moved on: the end of the listen. */
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    /** When the player last showed it, playing or paused; later snapshots within a few minutes carry it on. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    startPositionMs: integer('start_position_ms'),
    endPositionMs: integer('end_position_ms'),
    /** How much of the episode was heard. */
    listenedMs: integer('listened_ms').notNull(),
    contextUri: text('context_uri'),
    source: playSource('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('episode_listens_user_episode_started_key').on(t.userId, t.episodeId, t.startedAt),
    index('episode_listens_user_ended_idx').on(t.userId, t.endedAt),
    index('episode_listens_user_episode_idx').on(t.userId, t.episodeId, t.lastSeenAt),
  ],
)

/** How far into an episode the user is: Spotify's resume point when looked up, else what the player last showed. */
export const episodeProgress = pgTable(
  'episode_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    fullyPlayed: boolean('fully_played').notNull().default(false),
    resumePositionMs: integer('resume_position_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.episodeId] })],
)

/**
 * When a user's player was last looked at, and the episode it held. Claiming this row is what lets
 * one caller (the app's poll, or the background watcher in either process) record a snapshot,
 * so the same moment is never counted twice.
 */
export const playerWatch = pgTable('player_watch', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  episodeId: text('episode_id'),
})

/** A user's 1–5 star rating of an episode, like `track_ratings`. No row means unrated. */
export const episodeRatings = pgTable(
  'episode_ratings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    rating: smallint('rating').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId] }),
    check('episode_ratings_rating_range', sql`${t.rating} between 1 and 5`),
    index('episode_ratings_user_rating_idx').on(t.userId, t.rating),
  ],
)

/** The shows a user saved ("followed") on Spotify, as of the last sync. */
export const userShows = pgTable(
  'user_shows',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showId: text('show_id')
      .notNull()
      .references(() => shows.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.showId] })],
)

/**
 * Episodes in a playlist, beside its tracks in `playlist_items`: `position` is the index in
 * Spotify's list, so the two together are the playlist in order.
 */
export const playlistEpisodes = pgTable(
  'playlist_episodes',
  {
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    addedAt: timestamp('added_at', { withTimezone: true }),
    addedBy: text('added_by'),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.position] }), index('playlist_episodes_episode_idx').on(t.episodeId)],
)

export type Show = typeof shows.$inferSelect
export type Episode = typeof episodes.$inferSelect
export type EpisodeListen = typeof episodeListens.$inferSelect
