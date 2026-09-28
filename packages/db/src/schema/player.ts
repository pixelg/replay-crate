import { bigint, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

/**
 * Spotify Connect devices a user has played on. Spotify only lists devices with Spotify open
 * right now, so the player remembers the rest to offer them again.
 */
export const playerDevices = pgTable(
  'player_devices',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Spotify's id: null for devices it can't address. Some (the web player, some speakers)
     * get a new one each session, so a new id with a known name and type replaces the old one.
     */
    deviceId: text('device_id'),
    name: text('name').notNull(),
    /** Spotify's device type, e.g. Computer, Smartphone, Speaker. */
    type: text('type').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('player_devices_user_device_key').on(t.userId, t.deviceId)],
)

export type PlayerDevice = typeof playerDevices.$inferSelect
