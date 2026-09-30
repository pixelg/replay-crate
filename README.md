# Replay Crate

A personal Spotify companion that remembers everything you play.

- **History with context**: every play, and the playlist or album it was played from
- **Play counts**: per track, per playlist, across your whole listening history (backfilled from Spotify's data export)
- **Genres**: from Last.fm and MusicBrainz, since Spotify no longer provides them: on every track, as a History filter, in search and in stats
- **Playlists**: see play counts inside each playlist and which of your other playlists a track is on; build new playlists from your history
- **Stats**: top tracks, artists, albums and genres over any time range
- **Search**: everything in your library as you type (⌘K), typo-tolerant, with a small query language (by artist, genre, rating, when you played it…) and facets, on Elasticsearch or plain Postgres

Status and roadmap: [project board](https://github.com/users/pixelg/projects/4) · [milestones](https://github.com/pixelg/replay-crate/milestones)

## Stack

React 19 · Vite · TypeScript · Tailwind CSS 4 · TanStack Router + Query · Base UI · Hono · Drizzle + Postgres (Docker locally, Neon when deployed) · Elasticsearch + Kibana (optional) · varlock · Vitest · Storybook · pnpm workspaces + Turborepo · Node 24

## Getting started

Requirements: Node 24, pnpm (the version is pinned in `package.json`), Docker with Compose (for the local Postgres), and a Spotify developer app. Spotify's development mode requires the app owner to have Premium.

1. In the [Spotify dashboard](https://developer.spotify.com/dashboard), add the redirect URI `http://127.0.0.1:5173/callback`. Spotify doesn't accept `localhost`.
2. Create `.env.local` in the repo root. It's the only env file you edit, and every key is documented in `.env.schema`:

   ```bash
   SPOTIFY_CLIENT_ID=your-client-id
   LASTFM_API_KEY=...                   # optional: artist genres (free at last.fm/api/account/create)
   TOKEN_ENCRYPTION_KEY=...             # openssl rand -base64 32
   CRON_SECRET=...                      # openssl rand -hex 32
   ```

   You don't need a client secret: login uses PKCE. `DATABASE_URL` defaults to the local Postgres below, so leave it out.
3. Install, create the database, and run:

   ```bash
   pnpm install
   pnpm db:up
   pnpm db:migrate
   pnpm dev
   ```

   `pnpm db:up` starts Postgres 18 in Docker (`compose.yaml`) on 127.0.0.1:54320, with its data in a Docker volume. `pnpm dev` and `pnpm serve` start it too, so you only need this the first time. Stop it with `pnpm db:down`; open a SQL prompt with `pnpm db:psql`.

   Open http://127.0.0.1:5173. Use the IP, not `localhost`.

## Run it all day

Spotify only remembers your last 50 plays, so Replay Crate needs to be running to catch them all. The API syncs every connected account every 30 minutes (`SYNC_INTERVAL_MINUTES`) for as long as it's running, whether or not the app is open.

For everyday use, run the built app and the API as one server on http://127.0.0.1:4173. It uses port 4173 so it can run alongside `pnpm dev`.

1. Add `http://127.0.0.1:4173/callback` to your Spotify app's redirect URIs.
2. Try it:

   ```bash
   pnpm serve
   ```

3. Install it as a background service that starts with your desktop session. It's a systemd *user* service, so no sudo is needed:

   ```bash
   ./scripts/install-service.sh
   ```

   Logs: `journalctl --user -u replay-crate -f`. Stop: `systemctl --user stop replay-crate`.

4. After pulling changes, restart it with `systemctl --user restart replay-crate`, which rebuilds the app. A release's **Upgrading** notes say when more is needed first: `pnpm install` for new dependencies, `pnpm db:migrate` for new migrations, and after the restart `pnpm search:reindex` when the Elasticsearch index layout changed.

### Use it away from home (Tailscale)

[`tailscale serve`](https://tailscale.com/kb/1312/serve) gives the server a private HTTPS address, `https://<host>.<tailnet>.ts.net`, that only devices signed in to your tailnet can open. No router ports needed.

1. Sign this machine in with `sudo tailscale up`. In the Tailscale admin console under **DNS**, turn on MagicDNS and **HTTPS Certificates**.
2. Put the server behind it. `--bg` keeps it across reboots:

   ```bash
   sudo tailscale serve --bg 4173
   ```

   `tailscale serve status` shows the address.
3. Add `https://<host>.<tailnet>.ts.net/callback` to your Spotify app's redirect URIs.
4. Tell the server its address, either for one run or for the service:

   ```bash
   REPLAY_CRATE_ORIGIN=https://<host>.<tailnet>.ts.net pnpm serve
   ./scripts/install-service.sh https://<host>.<tailnet>.ts.net
   ```

The app works on one origin only, so `http://127.0.0.1:4173` now moves you over to the ts.net address, and you sign in again there once. Install Tailscale on your phone or laptop to reach it from anywhere. Run `./scripts/install-service.sh` without an address to go back to local-only.

## Import your full history

Replay Crate only sees plays from while it's running. To fill in everything before that, and any gaps since:

1. On Spotify's [Account privacy page](https://www.spotify.com/account/privacy/), request your **Extended streaming history**. It can take up to 30 days to arrive by email.
2. Open **Settings → Import** (or `/import`) and drop in `my_spotify_data.zip`. You don't need to unzip it.

The zip is read in your browser. Only each play's time, length and track id are uploaded, not the IP addresses, devices and other details in the export. Plays under 30 seconds are skipped, since Spotify doesn't count them as streams. Plays Replay Crate already has are skipped too, so importing again is safe.

Spotify no longer offers batch lookups, so tracks new to Replay Crate are fetched one at a time in the background while the app runs. For a large export this can take hours. The import page shows progress, and imported plays appear in History and Stats as their tracks arrive.

## Genres

Spotify no longer tells apps an artist's genres, so Replay Crate looks them up itself: Last.fm's listener tags first, then MusicBrainz when Last.fm has nothing. Only real genres count: tags are matched against MusicBrainz's list of about 2,200 genres, so tags like "seen live" drop out.

The lookups run in the background while the API runs, most recently played artists first, so today's listening gets genres before an old import does. A first pass over a few thousand artists takes about an hour. Each artist is looked up again every six months.

Genres show as chips on tracks, each opening History filtered to that genre. History has a genre picker, search has `genre:` and a Genre facet, and Stats ranks top genres.

A Last.fm API key is optional but finds more. It's free and issued instantly at [last.fm/api/account/create](https://www.last.fm/api/account/create): only the application name is required, and you can leave the callback URL empty. Put the key (not the shared secret) in `.env.local` as `LASTFM_API_KEY`. Without it, genres come from MusicBrainz alone.

## Search

Press **⌘K** (Ctrl+K) or **/** anywhere, or use the box at the top of the sidebar. Results come in as you type, grouped by type with the best match on top: tracks, artists, albums, playlists, and plays in your history. They're ranked by how well they match, then by how much you play and rate them. Enter opens a result, Shift+Enter plays it, Alt+Enter queues it, and ⌘Enter opens the full search page with facets.

Plain words match the start of any word in a name, artist or album, and forgive a typo or two ("pete rok", "beyonse"). Filters narrow things down:

| Filter | Example |
|---|---|
| `artist:` `album:` | `artist:"pete rock"` |
| `in:` (on a playlist) / `from:` (played from) | `in:"road trip"` |
| `genre:` (whole words, so `rock` finds art rock but not rockabilly) | `genre:jazz`, `genre:"hip hop"` |
| `rating:` `plays:` | `rating:>=4`, `plays:>10`, `rating:3..4` |
| `year:` | `year:1994`, `year:1990..1995`, `year:90s` |
| `played:` (when you played it, in your time zone) | `played:2024-09`, `played:2019..2020`, `played:>=2025-01`, `played:7d`, `played:today` |
| `type:` | `type:artist` (track, artist, album, playlist, play) |
| `-` excludes | `-type:play` |

### How it works

```
sync · import · rating · playlist edit
        │
        ▼
    Postgres ── triggers ──► search_outbox ── indexer (in the API) ──► search engine ◄── GET /api/v1/search
 (source of truth)            what changed      claim, rebuild docs       Elasticsearch,
                                                from SQL, write           or Postgres pg_trgm
```

- **Postgres is the source of truth.** The search index is a projection of it, per user, with your own play counts and ratings folded in for ranking.
- **Triggers feed an outbox.** Every change that could alter a search document is recorded in `search_outbox` by a database trigger, so nothing slips past: bulk imports, playlist resyncs, cascades, even edits made in `psql`. The API's indexer claims rows (`delete … for update skip locked returning`), rebuilds the affected documents from SQL, and retries failed batches with backoff.
- **Two engines, one contract.** With `ELASTICSEARCH_URL` set, search runs on Elasticsearch (`search_as_you_type` fields, fuzzy matching, `function_score` ranking, aggregations for facets, and the phrase suggester for "did you mean"). Without it, it runs on Postgres (`pg_trgm` + `unaccent`). One test suite (`apps/api/src/search/contract.ts`) must pass on both; CI runs it against a real Elasticsearch.
- **Zero-downtime rebuilds.** Elasticsearch reads go through the `rc-library` alias and writes through `rc-library-write`. `pnpm search:reindex` builds a fresh index behind the write alias while search keeps answering from the old one, then swaps the read alias atomically. Every write carries the time its document was built as an external version, so the live indexer and the rebuild can write at once and the newest data always wins.

### Run it with Elasticsearch

```bash
pnpm search:up
```

That starts Elasticsearch 9 and Kibana on 127.0.0.1 (the `search` profile in `compose.yaml`; `pnpm db:up` alone doesn't). Then add `ELASTICSEARCH_URL=http://127.0.0.1:9200` to `.env.local` and restart `pnpm dev` or `pnpm serve`. From then on `pnpm serve` (and the service) starts Elasticsearch and Kibana itself. On first start the API creates the index and indexes your whole library in the background. `pnpm search:reindex` rebuilds it any time; `pnpm search:down` stops the containers. Without Elasticsearch, search works the same on Postgres.

### Dashboards (Kibana)

With Elasticsearch, the API also keeps two indices of events for Kibana: `rc-plays` (every play, with its minutes and the hour and weekday it happened) and `rc-search-queries` (searches that led somewhere: what was asked, how much came back, which result was picked and from how far down). `pnpm kibana:load` imports two dashboards, defined as code in `infra/kibana/objects.ts`:

- **Listening** (http://127.0.0.1:5601/app/dashboards#/view/rc-listening): plays, hours and different tracks; plays over time; an hour × weekday heatmap of when you listen; minutes by where you played from; top artists and tracks.
- **Search** (http://127.0.0.1:5601/app/dashboards#/view/rc-search): searches over time; the share that found nothing; the average rank of what gets picked; top searches and the ones that came up empty; what types get picked; which filters get used.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web app + API with hot reload |
| `pnpm db:up` / `db:down` / `db:psql` | Local Postgres in Docker: start, stop, SQL prompt |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm test` | Unit tests and Storybook story tests (headless Chromium) |
| `pnpm test:e2e` | Playwright smoke tests against the built app + API (fake Spotify, in-memory DB) |
| `pnpm lint` / `pnpm typecheck` | oxlint / TypeScript |
| `pnpm build` | Production build of the web app |
| `pnpm serve` | Built app + API + scheduled sync on http://127.0.0.1:4173 |
| `pnpm storybook` | Component workshop at http://127.0.0.1:6006 |
| `pnpm search:up` / `search:down` | Elasticsearch + Kibana in Docker (optional; see [Search](#search)) |
| `pnpm search:reindex` | Rebuild the search index from Postgres |
| `pnpm kibana:load` | Import the Kibana dashboards (`infra/kibana`) |

## API

The API lives under `/api/v1` and describes itself with an OpenAPI 3.1 spec. With the app running, browse the interactive reference (Scalar) at http://127.0.0.1:5173/api/v1/docs (`pnpm dev`) or http://127.0.0.1:4173/api/v1/docs (`pnpm serve`); the raw spec is at `/api/v1/openapi.json`. Signed in to the app in the same browser, "Test Request" calls the API as you.

The first time you run `pnpm test`, install the test browser with `pnpm --filter @replay-crate/web exec playwright install chromium`.

## Contributing

Work is tracked as issues on the project board. Each change goes on a branch named after its issue (`feat/12-token-exchange`) and lands through a PR that closes it. See [CLAUDE.md](CLAUDE.md) for conventions.

## License

[MIT](LICENSE)
