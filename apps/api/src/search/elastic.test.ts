import { randomUUID } from 'node:crypto'
import { parseSearchQuery } from '@replay-crate/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeSearchIndexContract } from './contract.ts'
import { createElasticAnalytics } from './analytics.ts'
import { createElasticSearchIndex } from './elastic.ts'

// Runs against a real Elasticsearch when ELASTICSEARCH_URL is set (`pnpm search:up` locally, a
// service container in CI's search job); skipped otherwise. Read straight from the environment
// rather than varlock's ENV: it only decides whether this suite runs.
// oxlint-disable-next-line node/no-process-env
const node = process.env.ELASTICSEARCH_URL

describe.skipIf(!node)('elasticsearch', () => {
  describeSearchIndexContract('elasticsearch', async () => {
    // A fresh prefix per run, so runs (and the app's own index) never meet.
    const index = createElasticSearchIndex({ node: node!, prefix: `rc-test-${randomUUID().slice(0, 8)}`, refresh: true })
    await index.ensureIndex()
    return { index, refresh: () => index.refresh(), close: () => index.destroy() }
  })
})

describe.skipIf(!node)('elasticsearch rebuilds', () => {
  const prefix = `rc-test-${randomUUID().slice(0, 8)}`
  let clock = 1_000
  // Built lazily: a skipped describe still runs its body to collect tests.
  let index: ReturnType<typeof createElasticSearchIndex>
  beforeAll(() => {
    index = createElasticSearchIndex({ node: node!, prefix, refresh: true, now: () => clock })
  })
  const doc = (name: string) => ({
    userId: 'u1',
    type: 'track' as const,
    id: 't1',
    name,
    artists: [],
    album: null,
    playlists: [],
    contexts: [],
    year: null,
    playCount: 0,
    rating: null,
    lastPlayedAt: null,
    playedAt: null,
    imageUrl: null,
    trackId: null,
  })
  const names = async (text: string) =>
    (await index.search('u1', parseSearchQuery(text), { limit: 10 })).groups.flatMap((group) => group.hits.map((hit) => hit.name))

  afterAll(() => index.destroy())

  it('swaps indexes behind the aliases, and a stale write never beats a newer one', async () => {
    expect(await index.ensureIndex()).toEqual({ created: true, stale: false })
    expect(await index.ensureIndex()).toEqual({ created: false, stale: false })
    await index.upsert([doc('Old Name')])

    clock = 2_000
    const next = await index.beginRebuild()
    // Reads stay on the old index while the new one fills.
    expect(await names('old')).toEqual(['Old Name'])

    // The live indexer writes a rename (built at 3000); the rebuild then writes what it read
    // before the rename (built at 2500). The newer one stays.
    clock = 3_000
    await index.upsert([doc('New Name')])
    clock = 2_500
    await index.upsert([doc('Old Name')])

    await index.finishRebuild(next)
    await index.refresh()
    expect(await names('name')).toEqual(['New Name'])
    const indices = Object.keys(await index.client.indices.get({ index: `${prefix}-library-*` }))
    expect(indices).toEqual([next])
  })
})

describe.skipIf(!node)('elasticsearch analytics', () => {
  let analytics: ReturnType<typeof createElasticAnalytics>
  beforeAll(() => {
    analytics = createElasticAnalytics({ node: node!, prefix: `rc-test-${randomUUID().slice(0, 8)}`, refresh: true })
  })
  afterAll(() => analytics.destroy())

  it('keeps play and search events for Kibana', async () => {
    expect(await analytics.ensureIndices()).toEqual({ playsCreated: true })
    expect(await analytics.ensureIndices()).toEqual({ playsCreated: false })
    const event = {
      '@timestamp': '2026-09-21T11:00:00.000Z',
      userId: 'u1',
      playId: '1',
      trackId: 't1',
      track: 'Track',
      artists: ['Artist'],
      artist: 'Artist',
      album: 'Album',
      context: null,
      contextType: null,
      source: 'poll' as const,
      minutes: 3.5,
      hour: 11,
      weekday: '1 Mon',
    }
    await analytics.recordPlays([event, { ...event, playId: '2' }], [])
    await analytics.recordPlays([], [{ userId: 'u1', playId: '2' }])
    await analytics.recordSearch({
      '@timestamp': '2026-09-21T11:00:00.000Z',
      userId: 'u1',
      q: 'x',
      text: 'x',
      filters: [],
      filterFields: [],
      total: 0,
      zeroResults: true,
      source: 'page',
      pickedType: null,
      pickedId: null,
      pickedRank: null,
      engine: 'elasticsearch',
    })
    const client = createElasticSearchIndex({ node: node!, prefix: 'unused' }).client
    expect((await client.count({ index: analytics.playsIndex })).count).toBe(1)
    expect((await client.count({ index: analytics.searchesIndex })).count).toBe(1)
  })
})
