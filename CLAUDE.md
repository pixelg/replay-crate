# Replay Crate

Personal Spotify companion: records every play, counts plays per track, tags genres, manages playlists, and shows listening metrics. The work is planned as GitHub milestones (M0–M7, then M8–M12 for phase 2) on the [project board](https://github.com/users/pixelg/projects/4).

## Layout

pnpm workspace, tasks run by Turborepo (`turbo.json`). Packages export TypeScript source directly (no build step between packages).

| Path | What |
|---|---|
| `apps/web` | Vite SPA: React 19, TanStack Router (file routes in `src/routes`), TanStack Query, Base UI, Tailwind 4, Storybook |
| `apps/api` | Hono API on Node 24, served under `/api/v1` with its OpenAPI 3.1 spec at `/api/v1/openapi.json` and a Scalar reference at `/api/v1/docs`. `createApp()` in `src/app.ts` takes its dependencies as arguments; `src/index.ts` is the server entry |
| `packages/core` | Pure-TS domain logic shared by web, api, and a future React Native app |
| `packages/spotify` | Spotify Web API client and constants |
| `packages/db` | Drizzle schema + migrations. `createDb()` uses node-postgres for the local Docker Postgres and Neon's HTTP driver for `*.neon.tech`. `@replay-crate/db/testing` gives an in-process PGlite DB |
| `packages/api-client` | Typed Hono RPC client (`hc<AppType>`) + TanStack Query `queryOptions` factories |

## Commands

```bash
pnpm dev                # starts the DB, then web on http://127.0.0.1:5173 + api on :8787 (Vite proxies /api)
pnpm db:up / db:down    # local Postgres 18 in Docker (compose.yaml) on 127.0.0.1:54320
pnpm db:psql            # SQL prompt on the local database
pnpm lint               # oxlint
pnpm typecheck          # tsc in every package
pnpm test               # vitest everywhere; web runs every story as a browser test
pnpm build              # production build of the web app
pnpm serve              # built app + API + scheduled sync on :4173 (the everyday/always-on mode)
pnpm storybook          # component workshop on :6006
pnpm test:e2e           # Playwright smoke tests: built app + API, in-memory DB, fake Spotify
pnpm --filter @replay-crate/db db:generate   # new migration from schema changes
pnpm db:migrate         # apply migrations to DATABASE_URL
```

`typecheck`, `test`, `build`, `build-storybook`, `test:e2e` and `dev` go through `turbo run`, so unchanged packages replay cached results (`.turbo/cache`; add `--force` to rerun). A no-op `transit` task chains each package's hash to its workspace dependencies, since they share source rather than build output. Turbo runs tasks in strict env mode: a new env var a task reads must be added to `turbo.json` (`globalEnv` if it changes output, a pass-through list otherwise). `lint` is plain oxlint from the root.

## Conventions

- **Workflow:** never commit to `main` directly. One issue → branch `feat/<issue#>-slug` (or `fix/`, `chore/`) from `main` → PR with `Closes #n` → merge into `main`. Merge commits are fine. Conventional commit messages.
- **Env:** varlock. Values live in the root `.env.local`; each app's `.env.schema` imports what it needs from the root `.env.schema`. Secrets are `@sensitive` and can never reach the web bundle. Read config with `import { ENV } from 'varlock/env'`, never `process.env`. `env.d.ts` files are generated; commit them.
- **Dev host:** always `127.0.0.1`, never `localhost`. Spotify rejects `localhost` redirect URIs, and cookies and the pending login (sessionStorage) are per-origin. The web app moves itself to the origin of `SPOTIFY_REDIRECT_URI` at startup (`src/lib/app-origin.ts`).
- **Auth model:** the API owns every Spotify call and the refresh token (PKCE, no client secret). The browser never holds Spotify tokens. Scopes live in `SPOTIFY_SCOPES` (`packages/spotify/src/constants.ts`); `/auth/me` reports `missingScopes` (requested but not in the user's stored grant) and the app shows a reconnect banner for them, so adding a scope needs no migration. Spotify's grant covers every scope the user has ever given the app, not only the ones asked for at that login.
- **Running modes:** `pnpm dev` (Vite 5173 + API 8787) for development; `pnpm serve` (one origin on 4173, `WEB_DIST_DIR`) for everyday use, optionally as a systemd user service (`scripts/install-service.sh [origin]`). `REPLAY_CRATE_ORIGIN` moves serve mode to another origin, e.g. `https://<host>.<tailnet>.ts.net` behind `tailscale serve` for remote access; it sets `SPOTIFY_REDIRECT_URI` for both the build and the API. Both run the in-process sync scheduler (`SYNC_INTERVAL_MINUTES`); they can run at once against the same DB since syncs are idempotent. Env-schema changes need a `pnpm dev` restart (`varlock run` reads config at start).
- **Charts:** every chart, metric and stat uses [shadcn/ui charts](https://ui.shadcn.com/charts/area) (Base UI flavor, Recharts v3). No hand-rolled charts or other chart libraries.
- **UI:** mobile-first. shadcn/ui (Base UI flavor, `apps/web/components.json`) with our palette on shadcn's token names in `apps/web/src/styles.css`: `bg-background`, `text-muted-foreground`, `bg-card`, `bg-muted`, `bg-primary` (the brand orange), `bg-accent` (subtle hover surface, *not* the brand colour), `text-destructive`, `chart-1..5`. Never raw colours. Add shadcn components with `pnpm dlx shadcn@latest add <name>` from `apps/web` (review what it writes); our own Base UI wrappers live beside them in `src/components/ui`. Merge classes with `cn()` from the `cn` package; import from `@/…` or relatively.
- **Stories:** CSF Next (`preview.meta` / `meta.story`, import `preview` from `#storybook/preview`). Every story is a test that must pass its `play` function and the a11y check. Mock HTTP with `beforeEach({ msw }) { msw.use(...) }` using the typed `http` from `src/test/handlers.ts` (openapi-msw over `src/test/api.gen.ts`, generated from the API's spec), never `msw`'s own `http`: paths are the spec's (`/api/v1/tracks/{id}`), and a mock whose path or body drifts from the API fails `pnpm typecheck`. `defaultHandlers` there answers every read with fixtures; the full-app stories start from it. `pnpm typecheck` regenerates `apps/api/openapi.json` and `api.gen.ts` first; commit both (CI fails if they're stale).
- **Tests:** API tests call `createApp(...).request(...)` with a PGlite DB from `@replay-crate/db/testing`; no network. The fake Spotify (`apps/api/src/fakes.ts`, no test-framework imports) backs both the unit tests (`testing.ts` wraps it in `vi.fn`) and the E2E server (`apps/api/src/e2e-server.ts`). Its player (`fake-player.ts`) keeps real playback state (devices, item, progress on the test clock, queue, context) and fails the way Spotify does, with `SpotifyApiError.reason` (`NO_ACTIVE_DEVICE`, `PREMIUM_REQUIRED`, …); seed it with `ctx.player.nowPlaying(track)` or `ctx.player.deactivate()`. E2E specs live in `apps/web/e2e`; Playwright intercepts Spotify's authorize page and hands back a code, so the whole PKCE login runs.
- **Routes:** `src/routeTree.gen.ts` is generated by the router plugin on dev/build. Commit it.
- **API routes:** code-first OpenAPI with `@hono/zod-openapi`. Each module builds a router with `createRouter()` (`apps/api/src/lib/openapi.ts`) and declares each endpoint with `createRoute({ tags, operationId, request, responses })`: exactly one tag, with the path under that tag's prefix (`/api/v1/playlists/...` is tag `Playlists`), zod request *and* response schemas, and `...errorResponses('unauthorized', ...)` for every error the handler can return (the typed client's response types come from these). Route definitions sit at module level with `security: signedIn`; the module's factory attaches auth with `.openapi({ ...route, middleware: requireUser(deps) }, handler)`, which types `c.var.user`. Shared response schemas and the `jsonBody` / `jsonResponse` helpers are in `apps/api/src/lib/schemas.ts`; name reusable ones with `.openapi('Name')` so they become spec components. A new error code goes into `ERRORS` with its one status. Modules stay one chain and are mounted with `.route()` in `createApp`, so `AppType` and the spec both see them. `src/openapi.test.ts` fails when a route is undocumented or misfiled, and `src/openapi-conformance.test.ts` calls every endpoint and fails when a response doesn't match its declared schema (or has undeclared fields), so add a call there for each new route.
- **Errors (API):** every error response is JSON `{ error: <code>, ...details }`, declared once in `ERRORS` in `apps/api/src/lib/openapi.ts`: `invalid_request` (400, from the router's `defaultHook`), `unauthorized`, `forbidden`, `not_found`, `reauth_required` (409), `rate_limited`, `internal_error` (500, includes `requestId`). The player adds `no_active_device` (409), `premium_required` (403), `missing_scopes` (403, lists the scopes) and `command_refused` (403, with Spotify's `reason`), mapped from `SpotifyApiError.reason` in `apps/api/src/player/routes.ts`. Every response has `X-Request-Id`; 500s are logged with it.
- **Errors (web):** api-client calls throw `ApiError` (status, code, requestId; status 0 = no response). Anything else thrown is an app bug. `describeError()` in `apps/web/src/lib/describe-error.ts` maps both to what the UI says and offers, and `ErrorPage` is the one error screen: the router's default error component (inside the shell), full-screen for the root, `_app` and `/callback`, plus `AppErrorBoundary` around everything. Use `InlineError` for failed actions that shouldn't take over the page.
- **Imports (M3):** the browser parses the Extended Streaming History (`parseStreamingHistory` in `packages/core`) and uploads only `{ ts, ms, trackId }`. Keep it that way; the export holds IP addresses and device details. Plays land in `import_plays` (staging) and move to `plays` once their track is in the catalog: straight away for known tracks, otherwise after the `track` job fetches it (`promote()` in `apps/api/src/imports/service.ts`). A play within `DUPLICATE_WINDOW` of an existing play of the same track counts as a duplicate. The `track` job's 404 handler (`gone`) discards the staged plays and counts them as `unavailable`.

## Spotify Web API constraints (as of Sep 2026)

Development-mode apps were restricted in Feb/Mar 2026. Check these before designing a feature:

- `GET /me/player/recently-played` returns only the last 50 plays, and there's no play-count endpoint. Plays are recorded by polling (M2) and backfilled from the Extended Streaming History export (M3).
- Artist `genres` comes back null; `popularity` and `followers` were removed. Genres come from Last.fm tags with a MusicBrainz fallback (M4).
- Batch lookups (`GET /tracks`, `/artists`, `/albums`) were removed. Fetch one item at a time through the throttled job queue, and cache in the DB.
- Playlist `tracks` became `items` (`/playlists/{id}/items`), and contents are only returned for playlists the user owns or collaborates on. Create playlists with `POST /me/playlists`.
- Search `limit` max is 10.
- Refresh tokens expire 6 months after the user's consent, no matter how often they're refreshed. Handle `invalid_grant` by asking the user to reconnect.
- Dev mode allows 5 users max, and the app owner must have Premium.
