import { schema, type Db, type PlayerDevice } from '@replay-crate/db'
import type { SpotifyDevice } from '@replay-crate/spotify'
import { and, desc, eq } from 'drizzle-orm'

const { playerDevices } = schema

/** A device seen again within this long keeps its last_seen_at, so polling doesn't write every time. */
const SEEN_RESOLUTION_MS = 60_000

/**
 * Remembers devices Spotify reported just now (the active one, or its device list) and returns
 * each one's row, in order. A device is known by its id, or else by name and type, since some
 * get a new id each session: the old row takes the new id rather than a duplicate piling up.
 */
export async function rememberDevices(db: Db, userId: string, seen: SpotifyDevice[], now: Date): Promise<PlayerDevice[]> {
  const known = await db.select().from(playerDevices).where(eq(playerDevices.userId, userId)).orderBy(desc(playerDevices.lastSeenAt))
  const seenIds = new Set(seen.flatMap((device) => (device.id ? [device.id] : [])))
  const claimed = new Set<number>()
  const rows: PlayerDevice[] = []

  for (const device of seen) {
    const match =
      known.find((row) => device.id !== null && row.deviceId === device.id) ??
      // Most recent first. Not a row whose id is also listed now: two devices can share a name.
      known.find(
        (row) =>
          !claimed.has(row.id) &&
          row.name === device.name &&
          row.type === device.type &&
          !(row.deviceId && seenIds.has(row.deviceId)),
      )

    if (!match) {
      const [row] = await db
        .insert(playerDevices)
        .values({ userId, deviceId: device.id, name: device.name, type: device.type, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [playerDevices.userId, playerDevices.deviceId],
          set: { name: device.name, type: device.type, lastSeenAt: now },
        })
        .returning()
      rows.push(row!)
      continue
    }

    claimed.add(match.id)
    // A device that has lost its id (can't be addressed right now) keeps the one it had.
    const deviceId = device.id ?? match.deviceId
    const unchanged =
      match.deviceId === deviceId &&
      match.name === device.name &&
      match.type === device.type &&
      now.getTime() - match.lastSeenAt.getTime() < SEEN_RESOLUTION_MS
    if (unchanged) {
      rows.push(match)
      continue
    }
    const [row] = await db
      .update(playerDevices)
      .set({ deviceId, name: device.name, type: device.type, lastSeenAt: now })
      .where(eq(playerDevices.id, match.id))
      .returning()
    rows.push(row!)
  }
  return rows
}

/** Every device the user has played on, most recently seen first. */
export function rememberedDevices(db: Db, userId: string) {
  return db.select().from(playerDevices).where(eq(playerDevices.userId, userId)).orderBy(desc(playerDevices.lastSeenAt), desc(playerDevices.id))
}

/** Forgets a remembered device; false when the user has no such device. */
export async function forgetDevice(db: Db, userId: string, id: number): Promise<boolean> {
  const deleted = await db
    .delete(playerDevices)
    .where(and(eq(playerDevices.id, id), eq(playerDevices.userId, userId)))
    .returning({ id: playerDevices.id })
  return deleted.length > 0
}
