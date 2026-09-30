/**
 * The canonical genre list (the `genres` table) comes from MusicBrainz's genres, which are CC0.
 *
 *   node scripts/genres.ts --fetch                  refresh src/data/musicbrainz-genres.json
 *   node scripts/genres.ts migrations/0016_x.sql    write the seed into a custom migration
 *
 * To pick up genres MusicBrainz has added since: `--fetch`, then
 * `pnpm exec drizzle-kit generate --custom --name more_genres` and fill it with the second form.
 * The seed skips genres already there, so a later one only adds.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { genreKey } from '@replay-crate/core'

type MbGenre = { mbid: string; name: string }

const dataFile = new URL('../src/data/musicbrainz-genres.json', import.meta.url)
const USER_AGENT = 'replay-crate/0.1 (https://github.com/pixelg/replay-crate)'
const PAGE = 100

async function fetchAll(): Promise<MbGenre[]> {
  const all: MbGenre[] = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`https://musicbrainz.org/ws/2/genre/all?limit=${PAGE}&offset=${offset}&fmt=json`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`MusicBrainz answered ${res.status} at offset ${offset}`)
    const page = (await res.json()) as { genres: Array<{ id: string; name: string }>; 'genre-count': number }
    all.push(...page.genres.map((genre) => ({ mbid: genre.id, name: genre.name })))
    if (offset + PAGE >= page['genre-count']) return all
    // MusicBrainz allows one request a second.
    await new Promise((resolve) => setTimeout(resolve, 1_100))
  }
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const [arg] = process.argv.slice(2)
if (arg === '--fetch') {
  const genres = (await fetchAll()).toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
  await writeFile(dataFile, `${JSON.stringify(genres, null, 1)}\n`)
  console.log(`wrote ${genres.length} genres to ${dataFile.pathname}`)
} else if (arg) {
  const genres = JSON.parse(await readFile(dataFile, 'utf8')) as MbGenre[]
  // Two spellings with one key ("hip hop", "hip-hop") would break the key's uniqueness: first wins.
  const byKey = new Map<string, string>()
  for (const { name } of genres) if (!byKey.has(genreKey(name))) byKey.set(genreKey(name), name)
  const rows = [...byKey].map(([key, name]) => `  (${sqlString(name)}, ${sqlString(key)})`)
  const sql = [
    `-- MusicBrainz's genre list (CC0), from src/data/musicbrainz-genres.json by scripts/genres.ts.`,
    `INSERT INTO "genres" ("name", "key") VALUES`,
    `${rows.join(',\n')}`,
    `ON CONFLICT DO NOTHING;`,
    '',
  ].join('\n')
  await writeFile(arg, sql)
  console.log(`wrote ${rows.length} genres to ${arg}`)
} else {
  console.error('usage: node scripts/genres.ts --fetch | <migration.sql>')
  process.exit(1)
}
