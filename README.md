# Replay Crate

A personal Spotify companion that remembers everything you play.

- **History with context**: every play, and the playlist or album it was played from
- **Play counts**: per track, per playlist, across your whole listening history (backfilled from Spotify's data export)
- **Genres**: from Last.fm and MusicBrainz, since Spotify no longer provides them
- **Playlists**: see play counts inside each playlist and which of your other playlists a track is on; build new playlists from your history
- **Stats**: top tracks, artists, albums and genres over any time range

Status and roadmap: [project board](https://github.com/users/pixelg/projects/4) · [milestones](https://github.com/pixelg/replay-crate/milestones)

## Stack

React 19 · Vite · TypeScript · Tailwind CSS 4 · TanStack Router + Query · Base UI · Hono · Drizzle + Neon Postgres · varlock · Vitest · Storybook · pnpm workspaces · Node 24

## Getting started

Requirements: Node 24, pnpm (the version is pinned in `package.json`), and a Spotify developer app. Spotify's development mode requires the app owner to have Premium.

1. In the [Spotify dashboard](https://developer.spotify.com/dashboard), add the redirect URI `http://127.0.0.1:5173/callback`. Spotify doesn't accept `localhost`.
2. Create `.env.local` in the repo root. It's the only env file you edit, and every key is documented in `.env.schema`:

   ```bash
   SPOTIFY_CLIENT_ID=your-client-id
   DATABASE_URL=postgres://...          # a Neon dev branch
   LASTFM_API_KEY=...                   # needed from M4
   TOKEN_ENCRYPTION_KEY=...             # openssl rand -base64 32
   CRON_SECRET=...                      # openssl rand -hex 32
   ```

   You don't need a client secret: login uses PKCE.
3. Install and run:

   ```bash
   pnpm install
   pnpm dev
   ```

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

   Logs: `journalctl --user -u replay-crate -f`. Stop: `systemctl --user stop replay-crate`. After pulling changes, run `systemctl --user restart replay-crate`, which rebuilds the app.

## Import your full history

Replay Crate only sees plays from while it's running. To fill in everything before that, and any gaps since:

1. On Spotify's [Account privacy page](https://www.spotify.com/account/privacy/), request your **Extended streaming history**. It can take up to 30 days to arrive by email.
2. Open **Settings → Import** (or `/import`) and drop in `my_spotify_data.zip`. You don't need to unzip it.

The zip is read in your browser. Only each play's time, length and track id are uploaded, not the IP addresses, devices and other details in the export. Plays under 30 seconds are skipped, since Spotify doesn't count them as streams. Plays Replay Crate already has are skipped too, so importing again is safe.

Spotify no longer offers batch lookups, so tracks new to Replay Crate are fetched one at a time in the background while the app runs. For a large export this can take hours. The import page shows progress, and imported plays appear in History and Stats as their tracks arrive.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web app + API with hot reload |
| `pnpm test` | Unit tests and Storybook story tests (headless Chromium) |
| `pnpm test:e2e` | Playwright smoke tests against the built app + API (fake Spotify, in-memory DB) |
| `pnpm lint` / `pnpm typecheck` | oxlint / TypeScript |
| `pnpm build` | Production build of the web app |
| `pnpm serve` | Built app + API + scheduled sync on http://127.0.0.1:4173 |
| `pnpm storybook` | Component workshop at http://127.0.0.1:6006 |

The first time you run `pnpm test`, install the test browser with `pnpm --filter @replay-crate/web exec playwright install chromium`.

## Contributing

Work is tracked as issues on the project board. Each change goes on a branch named after its issue (`feat/12-token-exchange`) and lands through a PR that closes it. See [CLAUDE.md](CLAUDE.md) for conventions.
