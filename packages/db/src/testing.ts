import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from './client.ts'
import * as schema from './schema/index.ts'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
// The extensions search needs (migration 0008).
const extensions = { pg_trgm, unaccent }

let migrated: Promise<File | Blob> | undefined

/**
 * A data directory with every migration applied, made once per module instance (per test file).
 * Starting a database from it takes a quarter of a second; a new one (initdb) plus the
 * migrations takes over a second, which every test used to pay.
 */
function migratedDataDir() {
  migrated ??= (async () => {
    const client = new PGlite({ extensions })
    await migrate(drizzle({ client }), { migrationsFolder })
    const dataDir = await client.dumpDataDir('none')
    await client.close()
    return dataDir
  })()
  return migrated
}

/** In-process Postgres with all migrations applied, a fresh database each call. Call `close()` when done. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite({ extensions, loadDataDir: await migratedDataDir() })
  const db = drizzle({ client, schema })
  return { db, close: () => client.close() }
}
