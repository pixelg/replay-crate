import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

/** One row per Spotify account that has connected. Tokens are AES-GCM encrypted by the API. */
export const users = pgTable('users', {
  /** Spotify user id. */
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  imageUrl: text('image_url'),
  accessTokenEnc: text('access_token_enc').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scope: text('scope').notNull(),
  /** Spotify refresh tokens die 6 months after this, however often they're refreshed. */
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
  /** Set when a refresh fails with invalid_grant; cleared on the next login. */
  needsReauth: boolean('needs_reauth').notNull().default(false),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  playlistsSyncedAt: timestamp('playlists_synced_at', { withTimezone: true }),
  ...timestamps,
})

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the token itself is only ever in the client's cookie. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
