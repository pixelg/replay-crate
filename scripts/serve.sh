#!/usr/bin/env bash
# Runs Replay Crate for everyday use: builds the web app and serves it together with the
# API (and the scheduled Spotify sync) on http://127.0.0.1:4173. Port 4173 keeps it clear of
# `pnpm dev` (5173/8787), so both can run at once. Needs http://127.0.0.1:4173/callback in
# the Spotify app's redirect URIs.
set -euo pipefail
cd "$(dirname "$0")/.."

# The local database (compose.yaml). Already running is fine.
docker compose up --detach --wait

export API_PORT=4173
export SPOTIFY_REDIRECT_URI=http://127.0.0.1:4173/callback

# Its own output folder: `pnpm build` (dev/CI) writes apps/web/dist with the dev redirect
# URI baked in, and must never replace the files this server is serving.
pnpm --filter @replay-crate/web exec vite build --outDir dist-serve --emptyOutDir
WEB_DIST_DIR="$PWD/apps/web/dist-serve" exec pnpm --filter @replay-crate/api start
