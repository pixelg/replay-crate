// Server for the Playwright smoke tests: the built web app + API on a throwaway in-memory
// database with a fake Spotify. No network, no secrets; every start is a clean slate.
//   WEB_DIST_DIR  the web build to serve (required)
//   E2E_PORT      defaults to 4174
import { serve } from '@hono/node-server'
import { createTestDb } from '@replay-crate/db/testing'
import { createFakeLibrary, createFakeSpotify, play, playlistContext, track } from './fakes.ts'
import { createTokenCipher } from './lib/crypto.ts'
import { createServer } from './server.ts'

const port = Number(process.env.E2E_PORT ?? 4174)
const webDistDir = process.env.WEB_DIST_DIR
if (!webDistDir) throw new Error('Set WEB_DIST_DIR to the web build to serve')

const brass = track('brass', { name: 'Brass Monkey Business', album: ['dusty', 'Dusty Grooves'], artists: [['loop', 'The Loop Collective']] })
const sunday = track('sunday', { name: 'Sunday Morning Static', album: ['sessions', 'Sunday Sessions'], artists: [['kites', 'Paper Kites Club']] })
const searched = track('searched', { name: 'Searched And Played', album: ['found', 'Found It'], artists: [['direct', 'Direct Hit']] })

const library = createFakeLibrary()
library.add('late-night', [brass, sunday], 'Late Night Crate')
library.add('boom-bap', [brass, searched], 'Boom Bap Essentials')

// Plays relative to server start, so "Today" / "Yesterday" headings always make sense.
const startedAt = Date.now()
const ago = (minutes: number) => new Date(startedAt - minutes * 60_000).toISOString()
const recentlyPlayed = () => [
  play(brass, ago(5), playlistContext('late-night')),
  play(sunday, ago(9), playlistContext('late-night')),
  play(brass, ago(40), { type: 'album', uri: 'spotify:album:dusty' }),
  play(searched, ago(60 * 26), null),
  play(brass, ago(60 * 27), playlistContext('late-night')),
]

const { db } = await createTestDb()
const deps = {
  db,
  cipher: await createTokenCipher(Buffer.alloc(32, 9).toString('base64')),
  spotify: createFakeSpotify(library, { recentlyPlayed, topTracks: () => [brass, sunday] }),
  redirectUri: `http://127.0.0.1:${port}/callback`,
}

serve({ fetch: createServer(deps, { webDistDir }).fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`E2E server on http://${info.address}:${info.port} (fake Spotify, in-memory DB)`)
})
