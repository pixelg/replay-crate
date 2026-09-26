#!/usr/bin/env bash
# Installs Replay Crate as a systemd *user* service (no sudo): it starts with your desktop
# session, restarts if it crashes, and serves http://127.0.0.1:4173.
#   Usage:   ./scripts/install-service.sh [origin]
#            origin is the address you open it on, e.g. https://<host>.<tailnet>.ts.net behind
#            `tailscale serve` (see serve.sh). Leave it out for http://127.0.0.1:4173 only.
#   Logs:    journalctl --user -u replay-crate -f
#   Stop:    systemctl --user stop replay-crate
#   Remove:  systemctl --user disable --now replay-crate && rm ~/.config/systemd/user/replay-crate.service
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
origin="${1:-http://127.0.0.1:4173}"
origin="${origin%/}"
environment=""
if [ -n "${1:-}" ]; then environment="Environment=REPLAY_CRATE_ORIGIN=$origin"; fi
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/replay-crate.service" <<UNIT
[Unit]
Description=Replay Crate: app, API and scheduled Spotify sync on $origin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
$environment
ExecStart=$repo/scripts/run-service.sh
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now replay-crate
echo "Installed. Open $origin (logs: journalctl --user -u replay-crate -f)"
