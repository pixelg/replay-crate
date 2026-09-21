#!/usr/bin/env bash
# Installs Replay Crate as a systemd *user* service (no sudo): it starts with your desktop
# session, restarts if it crashes, and serves http://127.0.0.1:4173.
#   Logs:    journalctl --user -u replay-crate -f
#   Stop:    systemctl --user stop replay-crate
#   Remove:  systemctl --user disable --now replay-crate && rm ~/.config/systemd/user/replay-crate.service
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/replay-crate.service" <<UNIT
[Unit]
Description=Replay Crate: app, API and scheduled Spotify sync on http://127.0.0.1:4173
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$repo/scripts/run-service.sh
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now replay-crate
echo "Installed. Open http://127.0.0.1:4173 (logs: journalctl --user -u replay-crate -f)"
