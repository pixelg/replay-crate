// Server for the Playwright smoke tests: the built web app + API on a throwaway in-memory
// database with a fake Spotify. No network, no secrets; every start is a clean slate.
//   WEB_DIST_DIR  the web build to serve (required)
//   E2E_PORT      defaults to 4174
import { serve } from '@hono/node-server'
import { createTestDb } from '@replay-crate/db/testing'
import { createFakeLibrary, createFakeSpotify, play, playlistContext, track } from './fakes.ts'
import { startJobRunner } from './jobs/runner.ts'
import { createTokenCipher } from './lib/crypto.ts'
import { createServer } from './server.ts'
import { startSearchIndexer } from './search/indexer.ts'
import { createPostgresSearchIndex } from './search/postgres.ts'

const port = Number(process.env.E2E_PORT ?? 4174)
const webDistDir = process.env.WEB_DIST_DIR
if (!webDistDir) throw new Error('Set WEB_DIST_DIR to the web build to serve')

const brass = track('brass', { name: 'Brass Monkey Business', album: ['dusty', 'Dusty Grooves'], artists: [['loop', 'The Loop Collective']] })
const sunday = track('sunday', { name: 'Sunday Morning Static', album: ['sessions', 'Sunday Sessions'], artists: [['kites', 'Paper Kites Club']] })
const searched = track('searched', { name: 'Searched And Played', album: ['found', 'Found It'], artists: [['direct', 'Direct Hit']] })

const library = createFakeLibrary()
library.add('late-night', [brass, sunday], 'Late Night Crate')
library.add('boom-bap', [brass, searched], 'Boom Bap Essentials')
// Known only to (fake) Spotify's catalog: arrives through a streaming history import.
library.remember([
  track('4uLU6hMCjMI75M1A2tKUQC', { name: 'Imported Oldie', album: ['vault', 'From The Vault'], artists: [['keepers', 'Vault Keepers']] }),
  // Played only by the player spec, so the mini player it leaves behind clashes with nothing.
  track('warmup', { name: 'Needle Warm-Up', album: ['tests', 'Test Pressings'], artists: [['lathe', 'The Lathe']] }),
  track('encore', { name: 'Last Call Encore', album: ['tests', 'Test Pressings'], artists: [['lathe', 'The Lathe']] }),
])

// Plays pinned to calendar days from server start, so "Today" / "Yesterday" headings hold at any
// time of day (hour offsets cross midnight early in the morning).
const startedAt = Date.now()
const midnight = new Date(startedAt).setHours(0, 0, 0, 0)
/** `minutes` before start, but never before today's midnight (then seconds after it, keeping order). */
const today = (minutes: number) => new Date(Math.max(startedAt - minutes * 60_000, midnight + (60 - minutes) * 1_000)).toISOString()
const yesterdayAt = (hour: number) => new Date(midnight - (24 - hour) * 3_600_000).toISOString()
const recentlyPlayed = () => [
  play(brass, today(5), playlistContext('late-night')),
  play(sunday, today(9), playlistContext('late-night')),
  play(brass, today(40), { type: 'album', uri: 'spotify:album:dusty' }),
  play(searched, yesterdayAt(22), null),
  play(brass, yesterdayAt(21), playlistContext('late-night')),
]

const { db } = await createTestDb()
const deps = {
  db,
  cipher: await createTokenCipher(Buffer.alloc(32, 9).toString('base64')),
  spotify: createFakeSpotify(library, { recentlyPlayed, topTracks: () => [brass, sunday] }),
  redirectUri: `http://127.0.0.1:${port}/callback`,
  search: createPostgresSearchIndex(db),
}

// Looks up imported tracks, quickly so tests don't wait.
startJobRunner(deps, { idleMs: 500, busyPauseMs: 100, log: { info() {}, error: console.error } })
startSearchIndexer(deps, { idleMs: 200, busyPauseMs: 50, log: { info() {}, error: console.error } })

serve({ fetch: createServer(deps, { webDistDir }).fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`E2E server on http://${info.address}:${info.port} (fake Spotify, in-memory DB)`)
})
