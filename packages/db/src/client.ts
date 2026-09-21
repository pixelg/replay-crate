import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index.ts'

/** Driver-agnostic handle so app code works with Neon in prod and PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export function createDb(databaseUrl: string): Db {
  return drizzle({ client: neon(databaseUrl), schema })
}
