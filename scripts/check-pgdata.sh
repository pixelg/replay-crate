#!/usr/bin/env bash
# Runs before anything starts Postgres (`pnpm db:up`, `search:up`, `dev`, `serve`). With
# PGDATA_DIR set (shell or `.env`), the data lives in that directory, and a missing one must
# stop the start: Docker would create it empty and Postgres would start a brand-new, empty
# database without a word. That's what happens on Windows/WSL2 when the Linux disk isn't
# mounted yet: `/mnt/wsl/...` is then a plain directory in memory (tmpfs), and Docker Desktop
# keeps pointing at it even after the disk is mounted. Without PGDATA_DIR (the Docker
# volume), there's nothing to check.
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${PGDATA_DIR:-}"
if [ -z "$dir" ] && [ -f .env ]; then
  dir="$(sed -n 's/^[[:space:]]*PGDATA_DIR[[:space:]]*=[[:space:]]*//p' .env | tail -n 1)"
  dir="${dir%\"}"; dir="${dir#\"}"; dir="${dir%\'}"; dir="${dir#\'}"
fi
[ -n "$dir" ] || exit 0

fail() {
  echo "PGDATA_DIR=$dir: $1" >&2
  echo "Not starting Postgres: it would start an empty database instead of yours." >&2
  case "$dir" in
    /mnt/wsl/*)
      echo "Is the Linux disk mounted? From an administrator PowerShell:" >&2
      echo "  wsl --mount \\\\.\\PHYSICALDRIVE<n> --partition <p> --type ext4" >&2
      echo "(README, \"Use it from Windows\")." >&2
      ;;
  esac
  exit 1
}

# Postgres 18 images keep the cluster in 18/ under the data directory.
[ -d "$dir/18" ] || fail "no database here (expected $dir/18)."

if command -v findmnt >/dev/null 2>&1; then
  fstype="$(findmnt -n -o FSTYPE --target "$dir" || true)"
  [ "$fstype" != tmpfs ] || fail "this is in memory (tmpfs), not on a disk."
fi
