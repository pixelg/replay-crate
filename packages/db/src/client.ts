import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema/index.ts'

/** Driver-agnostic handle, so app code works with local Postgres, Neon and PGlite (tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** Neon's HTTP driver for Neon; node-postgres for any other Postgres, like the local Docker one. */
export function createDb(databaseUrl: string): Db {
  if (new URL(databaseUrl).hostname.endsWith('.neon.tech')) {
    return drizzleNeon({ client: neon(databaseUrl), schema })
  }
  const pool = new pg.Pool({ connectionString: databaseUrl })
  // A dropped idle connection (say, the database restarted) must not crash the server;
  // the pool reconnects on the next query.
  pool.on('error', (error) => console.error('[db] idle connection error', error.message))
  return drizzlePostgres({ client: pool, schema })
}
