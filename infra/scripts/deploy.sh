#!/usr/bin/env bash
# Deployment of a verified release on the production server (docs/release-workflow.md,
# "Deployment"; infra/README.md, "Deployment"). Run only as the forced command of the `deploy`
# user's SSH key, or by the owner on the server. The only input is one of:
#
#   deploy api=<commit> web=<commit> mcp-admin=<commit>   the verified tag set of the release job
#   rollback                                              back to the previous verified release
#
# As the forced command the input is SSH_ORIGINAL_COMMAND and arguments are ignored; otherwise it
# is the arguments. Every service is named exactly once, with a full 40-character commit SHA. Any
# other input is refused before anything runs, so the key can do nothing but deploy or roll back.
#
# A deployment pulls the images, backs up first when the release adds a migration (DEPLOY_BACKUP;
# while that script does not exist, such a release is refused), runs the one-off migration,
# recreates the changed services and waits for them to be healthy. When the migration or the
# health check fails it starts the previous release again and exits non-zero. A healthy release is
# appended to the record of verified releases, and local images of releases older than the
# previous one are removed.
#
# Settings, from the environment (the forced command sets the first two):
#   DEPLOY_ENV_FILE      the production environment file (infra/production/.env.example)
#   DEPLOY_STATE_DIR     where the record of verified releases (`releases`) and the lock live
#   DEPLOY_BACKUP        the backup script; default infra/scripts/backup.sh beside this script
#   DEPLOY_REGISTRY      the image registry; default the one of infra/production/compose.yaml
#   DEPLOY_WAIT_TIMEOUT  seconds to wait for healthy services; default 300
#   COMPOSE_FILE         the Compose files; default compose.yaml and infra/production/compose.yaml
#                        of this checkout

set -euo pipefail
set -f

SERVICES=(api web mcp-admin)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR=/app/packages/db/migrations
USAGE="usage: deploy api=<commit> web=<commit> mcp-admin=<commit> | rollback"

say() { printf 'deploy: %s\n' "$*" >&2; }
fail() {
  say "$*"
  exit 1
}

# --- Input -------------------------------------------------------------------------------------

if [[ -n "${SSH_ORIGINAL_COMMAND+set}" ]]; then
  input="$SSH_ORIGINAL_COMMAND"
else
  input="$*"
fi

# Only lower-case letters, digits, '=', '-' and single spaces: no shell syntax, paths or options
# can get through, whatever reads the words later.
if ((${#input} > 200)) || [[ ! "$input" =~ ^[a-z0-9=-]+( [a-z0-9=-]+)*$ ]]; then
  fail "$USAGE"
fi
read -r -a words <<<"$input"

# parse_set <array name> <word>...: a complete tag set, every service once with a commit SHA.
parse_set() {
  local -n into="$1"
  shift
  into=()
  local word service known
  for word in "$@"; do
    [[ "$word" =~ ^([a-z-]+)=([0-9a-f]{40})$ ]] || fail "not a service with a commit SHA: $word"
    service="${BASH_REMATCH[1]}"
    known=no
    for name in "${SERVICES[@]}"; do [[ "$name" == "$service" ]] && known=yes; done
    [[ "$known" == yes ]] || fail "unknown service: $service"
    [[ -z "${into[$service]:-}" ]] || fail "service named twice: $service"
    into[$service]="${BASH_REMATCH[2]}"
  done
  for service in "${SERVICES[@]}"; do
    [[ -n "${into[$service]:-}" ]] || fail "missing service: $service"
  done
}

# describe_set <array name>: the canonical record line of a tag set.
describe_set() {
  local -n tags="$1"
  local service line=""
  for service in "${SERVICES[@]}"; do line+="${line:+ }$service=${tags[$service]}"; done
  printf '%s' "$line"
}

declare -A target=()
command="${words[0]}"
case "$command" in
  deploy)
    parse_set target "${words[@]:1}"
    ;;
  rollback)
    ((${#words[@]} == 1)) || fail "$USAGE"
    ;;
  *)
    fail "$USAGE"
    ;;
esac

# --- Settings ----------------------------------------------------------------------------------

[[ -n "${DEPLOY_ENV_FILE:-}" ]] || fail "set DEPLOY_ENV_FILE to the production environment file"
[[ -n "${DEPLOY_STATE_DIR:-}" ]] || fail "set DEPLOY_STATE_DIR to the deployment state folder"
[[ -f "$DEPLOY_ENV_FILE" ]] || fail "DEPLOY_ENV_FILE is not a file: $DEPLOY_ENV_FILE"
[[ -d "$DEPLOY_STATE_DIR" ]] || fail "DEPLOY_STATE_DIR is not a folder: $DEPLOY_STATE_DIR"
REGISTRY="${DEPLOY_REGISTRY:-ghcr.io/sebelapetr}"
BACKUP="${DEPLOY_BACKUP:-$SCRIPT_DIR/backup.sh}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
[[ "$WAIT_TIMEOUT" =~ ^[0-9]+$ ]] || fail "DEPLOY_WAIT_TIMEOUT is not a number of seconds"
export COMPOSE_FILE="${COMPOSE_FILE:-$CHECKOUT/compose.yaml:$CHECKOUT/infra/production/compose.yaml}"
RELEASES="$DEPLOY_STATE_DIR/releases"

exec 9>"$DEPLOY_STATE_DIR/lock"
flock --nonblock 9 || fail "another deployment is running"

# --- Steps -------------------------------------------------------------------------------------

compose() { docker compose --env-file "$DEPLOY_ENV_FILE" "$@"; }

# use_set <array name>: the tags Compose interpolates into infra/production/compose.yaml.
use_set() {
  local -n tags="$1"
  export API_IMAGE_TAG="${tags[api]}" WEB_IMAGE_TAG="${tags[web]}"
  export MCP_ADMIN_IMAGE_TAG="${tags[mcp-admin]}"
}

start() { compose up --detach --wait --wait-timeout "$WAIT_TIMEOUT"; }

# recorded <n>: the n-th last verified release (1 is the current one); empty when there is none.
recorded() {
  [[ -f "$RELEASES" ]] || return 0
  local count
  count="$(grep -c . "$RELEASES" || true)"
  ((count >= $1)) || return 0
  grep . "$RELEASES" | tail -n "$1" | head -n 1
}

# load_set <array name> <record line>: a recorded line, validated like the input.
load_set() {
  local -a recorded_words
  read -r -a recorded_words <<<"$2"
  parse_set "$1" "${recorded_words[@]}"
}

# The migration files in an API image, one per line; fails when the image cannot be read.
migrations() {
  docker run --rm --pull never --network none --entrypoint ls "$REGISTRY/sebela-api:$1" \
    "$MIGRATIONS_DIR"
}

# Whether the target release adds a migration the current release does not have. Without a current
# release, or when its migrations cannot be read, it counts as adding one.
adds_migration() {
  local new_list current_list file
  new_list="$(migrations "${target[api]}")" ||
    fail "cannot read the migrations of the new API image; nothing changed"
  [[ -n "$current_line" ]] || return 0
  current_list="$(migrations "${current[api]}" 2>/dev/null)" || return 0
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    grep -qxF -- "$file" <<<"$current_list" || return 0
  done <<<"$new_list"
  return 1
}

# Removes local images of the three services whose tag is in neither of the last two releases.
prune() {
  local keep service repository reference tag
  keep=" $(tail -n 2 "$RELEASES" | tr '\n' ' ') "
  for service in "${SERVICES[@]}"; do
    repository="$REGISTRY/sebela-$service"
    while IFS= read -r reference; do
      tag="${reference##*:}"
      if [[ -z "$reference" || "$tag" == "<none>" || "$keep" == *" $service=$tag "* ]]; then
        continue
      fi
      docker image rm "$reference" >/dev/null || say "could not remove $reference"
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository" || true)
  done
}

current_line="$(recorded 1)"
declare -A current=()
[[ -z "$current_line" ]] || load_set current "$current_line"

if [[ "$command" == rollback ]]; then
  previous_line="$(recorded 2)"
  [[ -n "$previous_line" ]] || fail "there is no previous release to roll back to"
  load_set target "$previous_line"
  say "rolling back from $current_line to $previous_line"
  use_set target
  if start; then
    grep . "$RELEASES" | head -n -1 >"$RELEASES.new" && mv "$RELEASES.new" "$RELEASES"
    say "the previous release is running: $previous_line"
    prune
    exit 0
  fi
  use_set current
  if start; then
    fail "the previous release did not become healthy; the current release is running again: $current_line"
  fi
  fail "the previous release did not become healthy, and neither did the current release: $current_line"
fi

target_line="$(describe_set target)"
say "deploying $target_line"
use_set target
compose pull --policy missing || fail "pulling the images failed; nothing changed"

if adds_migration; then
  [[ -x "$BACKUP" ]] ||
    fail "the release adds a new migration and there is no backup script at $BACKUP" \
      "(issue #235); refusing to migrate without a backup; nothing changed"
  say "the release adds a new migration: backing up first"
  "$BACKUP" || fail "the backup failed; nothing changed"
fi

if compose run --rm --no-TTY migrate && start; then
  [[ "$target_line" == "$current_line" ]] || printf '%s\n' "$target_line" >>"$RELEASES"
  say "healthy: $target_line"
  prune
  exit 0
fi

[[ -n "$current_line" ]] ||
  fail "the release did not become healthy, and there is no previous release to return to"
say "the release did not become healthy; starting the previous release: $current_line"
use_set current
if start; then
  fail "the release failed; the previous release is running again: $current_line"
fi
fail "the release failed, and the previous release did not become healthy either: $current_line"
