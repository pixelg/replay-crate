import type { ImportedListen } from '@replay-crate/core'
import { schema, type Db } from '@replay-crate/db'
import { and, count, eq, sql } from 'drizzle-orm'

const { importListens, imports } = schema

/**
 * An imported listen and a recorded one of the same episode overlapping, give or take this, are
 * the same listen: the player saw it as it happened, and that record (with positions) stays.
 */
export const LISTEN_OVERLAP = '2 minutes'
const CHUNK = 2_000

/** Stages a chunk of uploaded listens and widens the import's date range. */
export async function addListens(db: Db, importId: number, userId: string, listens: ImportedListen[]): Promise<void> {
  if (!listens.length) return
  for (let i = 0; i < listens.length; i += CHUNK) {
    await db.insert(importListens).values(
      listens.slice(i, i + CHUNK).map((listen) => ({
        importId,
        userId,
        episodeId: listen.episodeId,
        endedAt: new Date(listen.ts),
        msPlayed: listen.ms,
      })),
    )
  }
  const times = listens.map((listen) => listen.ts).sort()
  await db
    .update(imports)
    .set({
      listenCount: sql`${imports.listenCount} + ${listens.length}`,
      earliest: sql`least(${imports.earliest}, ${new Date(times[0]!)})`,
      latest: sql`greatest(${imports.latest}, ${new Date(times.at(-1)!)})`,
    })
    .where(eq(imports.id, importId))
}

/**
 * Moves staged listens whose episode is in the catalog into `episode_listens` (optionally only
 * for `episodeIds`), skipping any that overlap a listen already recorded, then clears them from
 * staging. Imported listens are the real thing an `estimate` guessed at: one of the same episode
 * ending inside an estimate's window replaces it. Safe to run repeatedly: a listen imported twice
 * starts at the same moment.
 */
export async function promoteListens(db: Db, episodeIds?: string[]): Promise<void> {
  if (episodeIds && !episodeIds.length) return
  const onlyEpisodes = episodeIds
    ? sql`and il.episode_id in (${sql.join(
        episodeIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``
  const overlap = sql.raw(`interval '${LISTEN_OVERLAP}'`)

  await db.execute(sql`
    delete from episode_listens el
    where el.source = 'estimate'
      and exists (
        select 1 from import_listens il
        where il.user_id = el.user_id
          and il.episode_id = el.episode_id
          and exists (select 1 from episodes e where e.id = il.episode_id) ${onlyEpisodes}
          and il.ended_at between el.started_at - ${overlap} and el.ended_at + ${overlap}
      )
  `)
  await db.execute(sql`
    insert into episode_listens (user_id, episode_id, started_at, ended_at, last_seen_at, listened_ms, source)
    select il.user_id, il.episode_id, il.ended_at - il.ms_played * interval '1 millisecond', il.ended_at, il.ended_at, il.ms_played, 'import'
    from import_listens il
    where exists (select 1 from episodes e where e.id = il.episode_id) ${onlyEpisodes}
      and not exists (
        select 1 from episode_listens el
        where el.user_id = il.user_id
          and el.episode_id = il.episode_id
          and el.source <> 'estimate'
          and el.started_at <= il.ended_at + ${overlap}
          and el.ended_at >= il.ended_at - il.ms_played * interval '1 millisecond' - ${overlap}
      )
    on conflict (user_id, episode_id, started_at) do nothing
  `)
  await db.execute(sql`
    delete from import_listens il
    where exists (select 1 from episodes e where e.id = il.episode_id) ${onlyEpisodes}
  `)
}

/** Spotify no longer has this episode: count its staged listens against their imports and drop them. */
export async function discardEpisode(db: Db, userId: string, episodeId: string): Promise<void> {
  const mine = and(eq(importListens.userId, userId), eq(importListens.episodeId, episodeId))
  const perImport = await db
    .select({ importId: importListens.importId, n: count() })
    .from(importListens)
    .where(mine)
    .groupBy(importListens.importId)
  for (const { importId, n } of perImport) {
    await db
      .update(imports)
      .set({ listensUnavailable: sql`${imports.listensUnavailable} + ${n}` })
      .where(eq(imports.id, importId))
  }
  await db.delete(importListens).where(mine)
}
