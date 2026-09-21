#!/usr/bin/env bash
# Entry point for the systemd user service. systemd doesn't read your shell profile, so load
# nvm and the Node version from .nvmrc before starting.
set -eo pipefail
cd "$(dirname "$0")/.."

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null
fi

exec ./scripts/serve.sh
