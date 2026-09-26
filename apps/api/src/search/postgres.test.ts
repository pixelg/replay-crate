import { createTestDb } from '@replay-crate/db/testing'
import { describeSearchIndexContract } from './contract.ts'
import { createPostgresSearchIndex } from './postgres.ts'

describeSearchIndexContract('postgres', async () => {
  const { db, close } = await createTestDb()
  return { index: createPostgresSearchIndex(db), close }
})
