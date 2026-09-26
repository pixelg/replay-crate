#!/usr/bin/env bash
# Runs Replay Crate for everyday use: builds the web app and serves it together with the
# API (and the scheduled Spotify sync) on http://127.0.0.1:4173. Port 4173 keeps it clear of
# `pnpm dev` (5173/8787), so both can run at once. Needs <origin>/callback in the Spotify
# app's redirect URIs.
#
# REPLAY_CRATE_ORIGIN sets the one origin the app works on (default http://127.0.0.1:4173).
# Behind `tailscale serve`, set it to https://<host>.<tailnet>.ts.net: visits to 127.0.0.1
# then move over to that name.
set -euo pipefail
cd "$(dirname "$0")/.."

# The local database (compose.yaml). Already running is fine.
docker compose up --detach --wait

export API_PORT=4173
origin="${REPLAY_CRATE_ORIGIN:-http://127.0.0.1:4173}"
export SPOTIFY_REDIRECT_URI="${origin%/}/callback"

# Its own output folder: `pnpm build` (dev/CI) writes apps/web/dist with the dev redirect
# URI baked in, and must never replace the files this server is serving.
pnpm --filter @replay-crate/web exec vite build --outDir dist-serve --emptyOutDir
WEB_DIST_DIR="$PWD/apps/web/dist-serve" exec pnpm --filter @replay-crate/api start
