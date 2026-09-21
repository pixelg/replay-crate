import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from './testing.ts'

describe('createTestDb', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>

  beforeAll(async () => {
    testDb = await createTestDb()
  })
  afterAll(() => testDb.close())

  it('runs queries against an in-process Postgres', async () => {
    // `execute` is driver-specific, so the shared Db type leaves its result untyped.
    const result = await testDb.db.execute(sql`select 42 as answer`)
    expect(result).toMatchObject({ rows: [{ answer: 42 }] })
  })
})
