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
2. Create `.env.local` in the repo root. The schema, with descriptions of every variable, is in `.env.schema`, `apps/api/.env.schema` and `apps/web/.env.schema`.

   ```bash
   SPOTIFY_CLIENT_ID=your-client-id
   DATABASE_URL=postgres://...   # a Neon dev branch
   ```

   You don't need a client secret: login uses PKCE.
3. Install and run:

   ```bash
   pnpm install
   pnpm dev
   ```

   Open http://127.0.0.1:5173. Use the IP, not `localhost`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web app + API with hot reload |
| `pnpm test` | Unit tests and Storybook story tests (headless Chromium) |
| `pnpm lint` / `pnpm typecheck` | oxlint / TypeScript |
| `pnpm build` | Production build of the web app |
| `pnpm storybook` | Component workshop at http://127.0.0.1:6006 |

The first time you run `pnpm test`, install the test browser with `pnpm --filter @replay-crate/web exec playwright install chromium`.

## Contributing

Work is tracked as issues on the project board. Each change goes on a branch named after its issue (`feat/12-token-exchange`) and lands through a PR that closes it. See [CLAUDE.md](CLAUDE.md) for conventions.
