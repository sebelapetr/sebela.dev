# Shared by backup.sh, restore.sh and clear-demo.sh (docs/release-workflow.md, "Backups"): reads
# and checks the settings of the production environment file, and talks to the Bunny Storage zone
# of the backups. Sourced, never run. The sourcing script defines PREFIX (its name in messages)
# first and runs with `set -euo pipefail` and `set -f`.
#
# The environment file is read line by line, never sourced, so nothing in it runs. No secret is
# ever printed or passed on a command line: curl reads the address and the zone's password from
# its standard input (`--config -`), and a failed request reports only its HTTP status.

shopt -s inherit_errexit

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$CHECKOUT/compose.yaml:$CHECKOUT/infra/production/compose.yaml}"

# What the backups are called in the zone's `postgres/` folder: the UTC time they were taken.
BACKUP_NAME_PATTERN='^[0-9]{8}T[0-9]{6}Z\.dump\.age$'
# Database and role names: plain identifiers, so they can be written into SQL as they are.
IDENTIFIER_PATTERN='^[a-z_][a-z0-9_]{0,62}$'

say() { printf '%s: %s\n' "$PREFIX" "$*" >&2; }
fail() {
  say "$*"
  exit 1
}

# Picks the environment file: BACKUP_ENV_FILE, otherwise DEPLOY_ENV_FILE (set for the deploy user).
use_env_file() {
  ENV_FILE="${BACKUP_ENV_FILE:-${DEPLOY_ENV_FILE:-}}"
  [[ -n "$ENV_FILE" ]] || fail "set BACKUP_ENV_FILE or DEPLOY_ENV_FILE to the production environment file"
  [[ -f "$ENV_FILE" && -r "$ENV_FILE" ]] || fail "the environment file cannot be read: $ENV_FILE"
}

# setting <name>: the last value the environment file gives the name, without surrounding quotes.
setting() {
  local value
  value="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-)" || true
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

# load <name> <pattern>: sets the shell variable <name> from the environment file, or fails when the
# value is missing, still a `replace-with-...` placeholder or not of the expected form. The value
# itself is never printed: a wrong one may be a secret put in the wrong place.
load() {
  local value
  value="$(setting "$1")"
  [[ -n "$value" ]] || fail "$1 is not set in the environment file"
  [[ "$value" != replace-with-* ]] || fail "$1 is still a placeholder in the environment file"
  [[ "$value" =~ $2 ]] || fail "$1 in the environment file does not have the expected form"
  printf -v "$1" '%s' "$value"
}

# The settings of the zone the backups are stored in.
load_storage() {
  load BACKUP_STORAGE_ENDPOINT '^https?://[^/[:space:]"\\]+$'
  load BACKUP_STORAGE_ZONE '^[a-z0-9-]+$'
  load BACKUP_STORAGE_PASSWORD '^[A-Za-z0-9-]+$'
  BACKUPS_URL="$BACKUP_STORAGE_ENDPOINT/$BACKUP_STORAGE_ZONE/postgres/"
}

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# request <description> <output file> <curl option>... -- <url> [<header>]: one HTTP request, its
# address and header read by curl from standard input. Prints the HTTP status; fails with only the
# description and the status (or curl's exit code) when curl itself fails.
request() {
  local description="$1" output="$2"
  shift 2
  local options=()
  while [[ "$1" != -- ]]; do
    options+=("$1")
    shift
  done
  shift
  local url="$1" header="${2:-}" config status code=0
  config="url = \"$url\""$'\n'
  [[ -z "$header" ]] || config+="header = \"$header\""$'\n'
  status="$(curl --config - --globoff --silent --connect-timeout 10 --max-time 1800 \
    --output "$output" --write-out '%{http_code}' "${options[@]}" <<<"$config")" || code=$?
  ((code == 0)) || fail "$description failed (curl exit code $code)"
  printf '%s' "$status"
}

# storage <description> <output file> <accepted statuses> <path below postgres/> <curl option>...:
# a request to the zone with its password; fails unless the status is one of the accepted ones.
storage() {
  local description="$1" output="$2" accepted="$3" path="$4" status
  shift 4
  status="$(request "$description" "$output" "$@" -- "$BACKUPS_URL$path" \
    "AccessKey: $BACKUP_STORAGE_PASSWORD")"
  [[ " $accepted " == *" $status "* ]] || fail "$description failed (HTTP $status)"
}

# Prints the names of the backups in the zone, one per line, oldest first.
list_backups() {
  local listing="$1"
  storage "listing the backups" "$listing" "200" ""
  { grep -oE '"ObjectName"[[:space:]]*:[[:space:]]*"[^"]*"' "$listing" || true; } |
    sed -E 's/.*"([^"]*)"$/\1/' | { grep -E "$BACKUP_NAME_PATTERN" || true; } | sort
}
