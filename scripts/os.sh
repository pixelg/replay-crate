#!/usr/bin/env bash
# Dual boot (README, "Use it from Windows"): start Replay Crate on this OS, or shut it down
# before rebooting into the other one, step by step, saying what it does and what's left.
#   pnpm os:up       start here: check the disk and data, start Postgres (+ search), report
#   pnpm os:down     before rebooting: stop the app and Postgres, release leases, unmount (WSL)
#   pnpm os:status   what's running and what the database holds, changing nothing
# Runs on Linux and in the WSL2 distro on Windows. Flags: --no-reindex (os:up); --manual (WSL:
# don't mount or unmount the Linux disk, only print the administrator PowerShell command).
# Without --manual, WSL mounts/unmounts it through WSL interop: powershell.exe (a normal Windows
# process as you) asks Windows to run `wsl.exe --mount …` as administrator, so Windows shows its
# UAC prompt and nothing is elevated unless you approve it there.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-status}"; shift || true
reindex=1 manual=0
for arg in "$@"; do
  case "$arg" in
    --no-reindex) reindex=0 ;;
    --manual) manual=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- output -----------------------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\e[1m' DIM=$'\e[2m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' X=$'\e[0m'
else
  B='' DIM='' G='' Y='' R='' C='' X=''
fi
n=0
step() { n=$((n + 1)); printf '\n%s%d. %s%s\n' "$B" "$n" "$1" "$X"; }
ok()   { printf '   %s✓%s %s\n' "$G" "$X" "$1"; }
info() { printf '   %s·%s %s\n' "$DIM" "$X" "$1"; }
warn() { printf '   %s!%s %s\n' "$Y" "$X" "$1"; }
run()  { printf '   %s$ %s%s\n' "$C" "$*" "$X"; "$@" 2>&1 | sed 's/^/     /'; return "${PIPESTATUS[0]}"; }
# shows a command it ran or checked by other means, so each step can be repeated by hand
cmd()  { printf '   %s$ %s%s\n' "$C" "$1" "$X"; }
die()  { printf '   %s✗ %s%s\n' "$R" "$1" "$X"; shift; for l in "$@"; do printf '     %s\n' "$l"; done; exit 1; }
todo=()
next() { todo+=("$1"); }
finish() {
  if [ ${#todo[@]} -gt 0 ]; then
    printf '\n%sNext:%s\n' "$B" "$X"
    for t in "${todo[@]}"; do printf '   → %s\n' "$t"; done
  fi
  printf '\n'
}

# --- where are we -----------------------------------------------------------------------
if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then os=wsl; else os=linux; fi
host="$(hostname)"

pgdata="${PGDATA_DIR:-}"
if [ -z "$pgdata" ] && [ -f .env ]; then
  pgdata="$(sed -n 's/^[[:space:]]*PGDATA_DIR[[:space:]]*=[[:space:]]*//p' .env | tail -n 1)"
  pgdata="${pgdata%\"}"; pgdata="${pgdata#\"}"; pgdata="${pgdata%\'}"; pgdata="${pgdata#\'}"
fi

# On WSL the data sits on the Linux disk at /mnt/wsl/PHYSICALDRIVE<n>p<p>/...
disk='' part='' mnt=''
if [[ "$pgdata" =~ ^(/mnt/wsl/PHYSICALDRIVE([0-9]+)p([0-9]+)) ]]; then
  mnt="${BASH_REMATCH[1]}" disk="\\\\.\\PHYSICALDRIVE${BASH_REMATCH[2]}" part="${BASH_REMATCH[3]}"
fi
disk_mounted() { [ -n "$mnt" ] && mountpoint -q "$mnt"; }

has_service() { [ "$os" = linux ] && systemctl --user cat replay-crate >/dev/null 2>&1; }
service_active() { has_service && systemctl --user is-active --quiet replay-crate; }
pg_container() { docker compose ps -q postgres 2>/dev/null; }
pg_health() { local id; id="$(pg_container)"; [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo stopped; }
sql() { docker compose exec -T postgres psql -U replay replay_crate -qAtc "$1"; }
# Same, showing the query first; by hand: pnpm db:psql, then the query.
sqlv() { printf '   %s$ psql> %s;%s\n' "$C" "$1" "$X" >&2; sql "$1"; }
search_on() { [ -n "$(cd apps/api && node_modules/.bin/varlock printenv ELASTICSEARCH_URL 2>/dev/null)" ]; }
# What listens on the app's ports: 5173 web and 8787 api (pnpm dev), 4173 (pnpm serve or the service).
# One line per port: "8787 api (pnpm dev), pid 123".
app_ports() {
  local p='5173|8787|4173' line port pid
  [ "${1:-}" = no-serve ] && p='5173|8787'
  ss -Hltnp 2>/dev/null | grep -E ":($p)\b" | while IFS= read -r line; do
    port="$(grep -oE ":($p)\b" <<<"$line" | head -n 1)"; pid="$(grep -oE 'pid=[0-9]+' <<<"$line" | head -n 1)"; pid="${pid#pid=}"
    case "${port#:}" in 5173) what='web (pnpm dev)' ;; 8787) what='api (pnpm dev)' ;; *) what='pnpm serve or the service' ;; esac
    printf '%s %s, pid %s\n' "${port#:}" "$what" "${pid:-?}"
  done
}
# A UTC timestamp from Postgres, in this machine's local time.
local_time() { if [ -z "$1" ]; then echo none; else date -d "$1 UTC" '+%Y-%m-%d %H:%M %Z'; fi; }

# Runs `wsl.exe <args>` as administrator on Windows and waits for it. Windows shows its UAC
# prompt; declined or failed, the caller sees the disk unchanged. With --manual, or without WSL
# interop (no powershell.exe), it only says what to run.
elevate() {
  local how="In an administrator PowerShell:  wsl $1"
  if [ "$manual" = 1 ]; then info "--manual: $how"; return 0; fi
  if ! command -v powershell.exe >/dev/null 2>&1; then
    warn "can't reach Windows from here (WSL interop is off, see /etc/wsl.conf)"; info "$how"; return 0
  fi
  info "asking Windows to run it as administrator: approve the UAC prompt"
  cmd "powershell.exe Start-Process wsl.exe -Verb RunAs -Wait -ArgumentList '$1'"
  powershell.exe -NoProfile -Command \
    "\$p = Start-Process wsl.exe -Verb RunAs -Wait -PassThru -ArgumentList '$1'; exit \$p.ExitCode" 2>&1 | tr -d '\r' | sed 's/^/     /' || true
}

header() {
  printf '%sReplay Crate · %s%s\n' "$B" "$1" "$X"
  if [ "$os" = wsl ]; then info "Windows, WSL distro ${WSL_DISTRO_NAME:-?} (host $host)"; else info "Linux (host $host)"; fi
  if [ -n "$pgdata" ]; then info "Database files: $pgdata"; else info "Database files: Docker volume (PGDATA_DIR not set)"; fi
  info "Lines starting with \$ are the commands each step runs: run them yourself to do it by hand."
  info "SQL (psql>) runs in: pnpm db:psql"
}

report_db() {
  local plays last listens applied files
  info "what the database holds (the other OS's plays should be here)"
  plays="$(sqlv 'select count(*) from plays')"
  cmd "psql> select max(played_at) from plays;"
  last="$(local_time "$(sql "select to_char(max(played_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from plays")")"
  listens="$(sqlv 'select count(*) from episode_listens')"
  ok "$plays plays (last $last), $listens podcast listens"
  info "migrations: applied vs. files in packages/db/migrations"
  applied="$(sqlv 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo 0)"
  files="$(ls packages/db/migrations/*.sql | wc -l)"
  cmd "ls packages/db/migrations/*.sql | wc -l     # $files"
  if [ "$applied" -lt "$files" ]; then
    warn "$((files - applied)) migration(s) not applied yet"; next "pnpm db:migrate"
  else
    ok "migrations up to date ($applied)"
  fi
}

# Leases name the process holding them (host:pid:id). Postgres only listens on loopback, so a
# lease from another host can only be the other OS's, which is off: it'd block that background
# work until it lapsed (up to an hour), so free it.
clear_other_leases() {
  local rows
  info "leases still held by the other OS (host:pid in holder; this host is $host)"
  rows="$(sqlv "select name || ' (' || holder || ')' from worker_leases where holder not like '$host:%' and expires_at > now()")"
  if [ -z "$rows" ]; then ok "no leases left over from the other OS"; return; fi
  while IFS= read -r r; do info "left over: $r"; done <<<"$rows"
  sqlv "delete from worker_leases where holder not like '$host:%'" >/dev/null
  ok "released them, so this OS takes over the background work now"
}

# --- up ---------------------------------------------------------------------------------
up() {
  header "starting on this OS"

  if [ "$os" = wsl ]; then
    step "Linux disk"
    [ -n "$mnt" ] || die "PGDATA_DIR should be on the mounted Linux disk, /mnt/wsl/PHYSICALDRIVE<n>p<p>/..." \
      "Set it in .env (README, \"Use it from Windows\")."
    info "PGDATA_DIR is on the Linux disk, which WSL sees only once it's mounted"
    cmd "mountpoint $mnt"
    if disk_mounted; then
      ok "mounted at $mnt"
    else
      warn "not mounted at $mnt"
      elevate "--mount $disk --partition $part --type ext4"
      # Mounting by hand: wait for it here rather than making you start over.
      while ! disk_mounted && [ -t 0 ] && read -r -p "   Press Enter once it's mounted (Ctrl-C to stop) " _; do :; done
      disk_mounted || die "Not mounted. Mount it (administrator PowerShell), then run pnpm os:up again:" \
        "wsl --mount $disk --partition $part --type ext4"
      ok "mounted at $mnt"
    fi
  fi

  step "Database files"
  info "make sure PGDATA_DIR holds the database, so Postgres doesn't start an empty one"
  run ./scripts/check-pgdata.sh || die "Not starting Postgres on the wrong directory."
  ok "a Postgres 18 database is there"

  step "Start Postgres$(search_on && echo ' and Elasticsearch')"
  # Only the databases: the app itself runs in a terminal (pnpm dev or pnpm serve), where you
  # see it and stop it with Ctrl-C.
  info "only the databases; the app runs in a terminal afterwards (pnpm dev or pnpm serve)"
  cmd "docker compose ps     # what's up already"
  if [ "$(pg_health)" = healthy ]; then ok "Postgres is already up"
  else run pnpm db:up || die "pnpm db:up failed (output above)."; ok "Postgres is up"; fi
  if search_on; then run pnpm search:up || die "pnpm search:up failed (output above)."; ok "Elasticsearch is up"; fi
  if service_active; then warn "the replay-crate service is running (stop it with: systemctl --user stop replay-crate)"; fi
  if has_service && systemctl --user is-enabled --quiet replay-crate; then
    warn "the replay-crate service starts at login (turn that off: systemctl --user disable replay-crate)"
  fi

  step "Database"
  report_db
  step "Leases"
  info "each background job runs in one process at a time; a lease the other OS still holds blocks it here until it lapses"
  clear_other_leases

  if search_on; then
    step "Search"
    if [ "$reindex" = 1 ]; then
      info "plays recorded on the other OS only reached its own index; rebuilding it (a few minutes)"
      run pnpm search:reindex || { warn "reindex failed (output above)"; next "pnpm search:reindex"; }
    else
      info "skipped (--no-reindex)"; next "pnpm search:reindex"
    fi
  fi

  next "pnpm dev  (development), or pnpm serve  (everyday, :4173); Ctrl-C stops either"
  finish
}

# --- down -------------------------------------------------------------------------------
down() {
  header "shutting down before switching OS"

  step "Stop the app"
  # Refuse before stopping anything: pnpm dev / pnpm serve run in a terminal and must be
  # stopped there. The service's own 4173 is fine, it's stopped next.
  info "pnpm dev and pnpm serve must be stopped in their terminals (Ctrl-C) first"
  cmd "ss -ltnp | grep -E ':(5173|8787|4173)'     # 5173 web + 8787 api: pnpm dev; 4173: pnpm serve"
  local ports; if service_active; then ports="$(app_ports no-serve)"; else ports="$(app_ports)"; fi
  if [ -n "$ports" ]; then
    warn "pnpm dev or pnpm serve is still running:"
    while IFS= read -r l; do info "$l"; done <<<"$ports"
    die "Stop it first (Ctrl-C in its terminal), then run pnpm os:down again."
  fi
  ok "no pnpm dev or pnpm serve running"
  if service_active; then run systemctl --user stop replay-crate || die "couldn't stop the service (output above)."; ok "stopped the replay-crate service"
  elif has_service; then cmd "systemctl --user is-active replay-crate"; ok "the replay-crate service isn't running"; fi

  step "Leases"
  info "free this OS's background-job leases, so the other OS takes over at once"
  if [ "$(pg_health)" = healthy ]; then
    local held; held="$(sqlv "delete from worker_leases where holder like '$host:%' returning name" | tr '\n' ' ')"
    if [ -n "$held" ]; then ok "released $held(the other OS can take over at once)"
    else ok "this OS holds none"; fi
  else
    info "Postgres isn't running, nothing to release"
  fi

  step "Stop Postgres (and Elasticsearch, Kibana)"
  info "a clean shutdown, so the other OS opens the database without recovery (same as pnpm db:down)"
  if [ -n "$(docker compose ps -q 2>/dev/null)" ]; then
    run docker compose stop || die "docker compose stop failed (output above)."
    ok "stopped"
  else
    ok "nothing running"
  fi

  if [ "$os" = wsl ]; then
    step "Detach the Linux disk"
    info "give the disk back cleanly before Linux boots from it"
    cmd "mountpoint $mnt"
    if ! disk_mounted; then
      ok "not mounted"
    else
      elevate "--unmount $disk"
      if disk_mounted; then warn "still mounted"; next "wsl --unmount $disk  (administrator PowerShell), then reboot into Linux"
      else ok "unmounted"; next "reboot into Linux, then: pnpm os:up"; fi
    fi
  else
    next "reboot into Windows; in the WSL distro: pnpm os:up"
  fi
  finish
}

# --- status -----------------------------------------------------------------------------
status() {
  header "status"
  step "Running"
  if [ "$os" = wsl ] && [ -n "$mnt" ]; then
    if disk_mounted; then ok "Linux disk mounted at $mnt"; else warn "Linux disk not mounted at $mnt"; fi
  fi
  if has_service; then
    if service_active; then ok "replay-crate service running"; else info "replay-crate service stopped"; fi
  fi
  local health; health="$(pg_health)"
  if [ "$health" = healthy ]; then ok "Postgres up"; else info "Postgres: $health"; fi
  local ports; ports="$(app_ports)"
  if [ -n "$ports" ]; then while IFS= read -r l; do info "port $l"; done <<<"$ports"; fi
  if [ "$health" = healthy ]; then
    step "Database"
    report_db
    local rows name holder until; rows="$(sql "select name, holder, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from worker_leases where expires_at > now() order by name")"
    if [ -z "$rows" ]; then info "no leases held"; fi
    while IFS='|' read -r name holder until; do
      [ -n "$name" ] && info "lease $name → ${holder%:*} until $(local_time "$until" | cut -d' ' -f2-)"
    done <<<"$rows"
  fi
  finish
}

case "$cmd" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) echo "Usage: $0 up|down|status [--no-reindex] [--manual]" >&2; exit 2 ;;
esac
