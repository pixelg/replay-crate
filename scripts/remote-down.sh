#!/usr/bin/env bash
# Back home: lets the machine sleep again and takes Tailscale down. Don't run it while
# you're connected through Tailscale: it cuts that connection. `tailscale serve` settings are
# kept, so remote-up.sh restores access.
#   Usage:   ./scripts/remote-down.sh [--keep-tailscale]   (or: pnpm remote:down)
set -euo pipefail
unit=replay-crate-awake

if systemctl --user is-active --quiet "$unit"; then
  systemctl --user stop "$unit"
  echo "Released the keep-awake hold; the machine can sleep again."
else
  echo "Wasn't holding the machine awake."
fi

if [ "${1:-}" != "--keep-tailscale" ]; then
  tailscale down
  echo "Tailscale is down."
fi
