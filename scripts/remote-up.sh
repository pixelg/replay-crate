#!/usr/bin/env bash
# Going away: brings Tailscale up and keeps this machine awake (no suspend, no idle, lid closed
# included) until you run remote-down.sh. The hold is a transient systemd user unit, so it
# survives this terminal closing and dies on reboot.
#   Usage:   ./scripts/remote-up.sh        (or: pnpm remote:up)
#   Check:   systemctl --user status replay-crate-awake
# If `tailscale up` asks for sudo, run once: sudo tailscale set --operator="$USER"
set -euo pipefail
unit=replay-crate-awake

# Already connected (e.g. it never went down): nothing to do, so no operator rights needed.
if [ "$(tailscale status --json | grep -o '"BackendState": *"[A-Za-z]*"')" != '"BackendState": "Running"' ]; then
  tailscale up
fi

if systemctl --user is-active --quiet "$unit"; then
  echo "Already keeping this machine awake ($unit)."
else
  systemd-run --user --quiet --unit="$unit" \
    --description="Replay Crate: keep awake while remote" \
    systemd-inhibit --what=sleep:idle:handle-lid-switch --who="Replay Crate" \
      --why="Away from home, reaching it over Tailscale" --mode=block \
      sleep infinity
  echo "Keeping this machine awake until ./scripts/remote-down.sh."
fi

if ! systemctl --user is-active --quiet replay-crate; then
  echo "Note: the replay-crate service isn't running (./scripts/install-service.sh, or pnpm serve)."
fi
tailscale status --self=true --peers=false
