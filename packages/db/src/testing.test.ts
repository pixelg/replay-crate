import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { genres } from './schema/index.ts'
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

  it('gives each call its own migrated database', async () => {
    const other = await createTestDb()
    try {
      // Both start from the same migrated data, the genre seed included…
      const seeded = await testDb.db.$count(genres)
      expect(seeded).toBeGreaterThan(1000)
      await expect(other.db.$count(genres)).resolves.toBe(seeded)
      // …and what one changes, the other doesn't see.
      await other.db.delete(genres)
      await expect(other.db.$count(genres)).resolves.toBe(0)
      await expect(testDb.db.$count(genres)).resolves.toBe(seeded)
    } finally {
      await other.close()
    }
  })
})
