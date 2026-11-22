#!/usr/bin/env bash
# Deployment of a verified release on the production server (docs/release-workflow.md,
# "Deployment"; infra/README.md, "Deployment"). Run only as the forced command of the `deploy`
# user's SSH key, or by the owner on the server. The only input is one of:
#
#   deploy release=<commit> api=<commit> web=<commit> mcp-admin=<commit>
#             the release commit and the verified tag set of the release job
#   rollback  back to the previous verified release
#
# As the forced command the input is SSH_ORIGINAL_COMMAND and arguments are ignored; otherwise it
# is the arguments. The release commit and every service are named exactly once, each with a full
# 40-character commit SHA. Any other input is refused before anything runs, so the key can do
# nothing but deploy or roll back.
#
# A deployment first brings this checkout to the release commit, so the script, the Compose files
# and the backup script of the release are the ones that run: it fetches origin, refuses a commit
# that is not on origin/master and a checkout with local modifications (nothing changed either
# way), checks the commit out detached and runs the checked-out deploy.sh again, once, with
# DEPLOY_RELEASE_CHECKED_OUT set to the commit; that run checks the checkout is at the commit and
# goes on. A rollback leaves the checkout as it is.
#
# A deployment pulls the images, backs up first when the release adds a migration (DEPLOY_BACKUP,
# which reads the same DEPLOY_ENV_FILE; without an executable backup script such a release is
# refused), runs the one-off migration,
# recreates the changed services and waits for them to be healthy. When the migration or the
# health check fails it starts the previous release again and exits non-zero. A healthy release is
# appended to the record of verified releases, and local images of releases older than the
# previous one are removed.
#
# Before any of that, and before a rollback starts anything, the script checks that the current
# user can keep the state: the state folder writable, the record a readable and writable file when
# it exists, the lock openable. Otherwise it stops with nothing changed. Should the record still
# not take the change after a healthy start, the release keeps running (it is not rolled back for
# a bookkeeping fault), no image is removed, and the script says what is running, which line the
# record lacks or still holds, and exits non-zero, so the job fails and publishes no version until
# the record is right.
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
USAGE="usage: deploy release=<commit> api=<commit> web=<commit> mcp-admin=<commit> | rollback"

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
release=""
command="${words[0]}"
case "$command" in
  deploy)
    service_words=()
    for word in "${words[@]:1}"; do
      if [[ "$word" == release=* ]]; then
        [[ -z "$release" ]] || fail "release commit named twice"
        [[ "$word" =~ ^release=([0-9a-f]{40})$ ]] || fail "not a release commit SHA: $word"
        release="${BASH_REMATCH[1]}"
      else
        service_words+=("$word")
      fi
    done
    [[ -n "$release" ]] || fail "missing release commit: $USAGE"
    parse_set target "${service_words[@]}"
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
[[ -f "$DEPLOY_ENV_FILE" ]] || fail "DEPLOY_ENV_FILE does not name a file"
[[ -d "$DEPLOY_STATE_DIR" ]] || fail "DEPLOY_STATE_DIR does not name a folder"
REGISTRY="${DEPLOY_REGISTRY:-ghcr.io/sebelapetr}"
BACKUP="${DEPLOY_BACKUP:-$SCRIPT_DIR/backup.sh}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
[[ "$WAIT_TIMEOUT" =~ ^[0-9]+$ ]] || fail "DEPLOY_WAIT_TIMEOUT is not a number of seconds"
export COMPOSE_FILE="${COMPOSE_FILE:-$CHECKOUT/compose.yaml:$CHECKOUT/infra/production/compose.yaml}"
RELEASES="$DEPLOY_STATE_DIR/releases"
LOCK="$DEPLOY_STATE_DIR/lock"

# --- The state ---------------------------------------------------------------------------------

# Checked before anything changes: a rollback and the fallback of a failed deployment start what
# the record names, so a release that cannot be recorded must not be started. The messages name
# the user and never a path: the output of a deployment is a public log.
WHOAMI="$(id -un 2>/dev/null)" || WHOAMI="the current user"
[[ -w "$DEPLOY_STATE_DIR" && -x "$DEPLOY_STATE_DIR" ]] ||
  fail "the state folder is not writable by $WHOAMI; nothing changed"
if [[ -e "$RELEASES" || -L "$RELEASES" ]]; then
  [[ -f "$RELEASES" ]] || fail "the record of verified releases is not a file; nothing changed"
  [[ -r "$RELEASES" && -w "$RELEASES" ]] ||
    fail "the record of verified releases is not writable by $WHOAMI; nothing changed"
fi
[[ ! -e "$LOCK" || (-f "$LOCK" && -w "$LOCK") ]] ||
  fail "the lock of the state folder cannot be opened by $WHOAMI; nothing changed"
{ exec 9>"$LOCK"; } 2>/dev/null ||
  fail "the lock of the state folder cannot be opened by $WHOAMI; nothing changed"
flock --nonblock 9 || fail "another deployment is running; nothing changed"

# --- The checkout ------------------------------------------------------------------------------

checkout_git() { git -C "$CHECKOUT" "$@"; }

# Brings the checkout to the release commit and runs the release's deploy.sh in place of this one.
# Only a commit on origin/master is checked out, so the input cannot choose code of its own. The
# function is read whole before it runs, and exec replaces this process, so nothing of this file is
# read after the checkout changed it. The re-executed script opens the lock again, which closes
# this one's.
checkout_release() {
  if [[ -n "${DEPLOY_RELEASE_CHECKED_OUT:-}" ]]; then
    [[ "$DEPLOY_RELEASE_CHECKED_OUT" == "$release" &&
      "$(checkout_git rev-parse HEAD 2>/dev/null)" == "$release" ]] ||
      fail "the checkout is not at the release commit $release; nothing changed"
    return 0
  fi
  checkout_git fetch --quiet origin || fail "cannot fetch origin; nothing changed"
  checkout_git merge-base --is-ancestor "$release" refs/remotes/origin/master 2>/dev/null ||
    fail "the release commit $release is not on origin/master; nothing changed"
  local changes
  changes="$(checkout_git status --porcelain --untracked-files=no)" ||
    fail "cannot read the state of the checkout; nothing changed"
  [[ -z "$changes" ]] || fail "the checkout has local modifications; nothing changed"
  checkout_git -c advice.detachedHead=false checkout --quiet --detach "$release" ||
    fail "cannot check out the release commit $release; nothing changed"
  say "the checkout is at the release commit $release"
  DEPLOY_RELEASE_CHECKED_OUT="$release" exec bash "$CHECKOUT/infra/scripts/deploy.sh" "$@"
}

[[ "$command" != deploy ]] || checkout_release "$@"

# --- Steps -------------------------------------------------------------------------------------

compose() { docker compose --env-file "$DEPLOY_ENV_FILE" "$@"; }

# use_set <array name>: the tags Compose interpolates into infra/production/compose.yaml.
use_set() {
  local -n tags="$1"
  export API_IMAGE_TAG="${tags[api]}" WEB_IMAGE_TAG="${tags[web]}"
  export MCP_ADMIN_IMAGE_TAG="${tags[mcp-admin]}"
}

# Starts the long-running services of the exported tag set and waits until they are healthy. They
# are named, with --no-deps, so `up` never starts the one-off migration: a deployment runs it
# exactly once, before this, and a rollback never runs it.
start() {
  compose up --detach --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps postgres "${SERVICES[@]}"
}

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
    if ! { grep . "$RELEASES" | head -n -1 >"$RELEASES.new" && mv "$RELEASES.new" "$RELEASES"; } \
      2>/dev/null; then
      say "the previous release is running, but the record still names the newer release as the" \
        "current one: $WHOAMI could not rewrite the record of verified releases"
      say "do not roll back again; make the state folder and the record writable for $WHOAMI," \
        "then remove this last line from the record:"
      say "  $current_line"
      exit 1
    fi
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
    fail "the release adds a new migration and there is no executable backup script (DEPLOY_BACKUP);" \
      "refusing to migrate without a backup; nothing changed"
  say "the release adds a new migration: backing up first"
  "$BACKUP" || fail "the backup failed; nothing changed"
fi

if compose run --rm --no-TTY migrate && start; then
  # The services are healthy on the new release and the migration is applied: starting the
  # previous release again would add an interruption and repair nothing, so a record that cannot
  # be written is reported and left to the owner, and the images stay for whatever comes next.
  if [[ "$target_line" != "$current_line" ]] &&
    ! { printf '%s\n' "$target_line" >>"$RELEASES"; } 2>/dev/null; then
    say "the release is healthy and is running but is NOT recorded: $WHOAMI could not write the" \
      "record of verified releases"
    say "until it is recorded, a rollback and the fallback of a failed deployment start the" \
      "wrong release"
    say "make the record writable for $WHOAMI, then run this deployment again or append this" \
      "line to the record:"
    say "  $target_line"
    exit 1
  fi
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
