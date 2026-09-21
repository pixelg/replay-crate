import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from './client.ts'
import * as schema from './schema/index.ts'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

/** In-process Postgres with all migrations applied. Call `close()` when done. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder })
  return { db, close: () => client.close() }
}
