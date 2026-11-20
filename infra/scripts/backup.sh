#!/usr/bin/env bash
# Encrypted backup of the production database off the server (docs/release-workflow.md, "Backups";
# infra/README.md, "Backups"). Run nightly from infra/crons.txt and by deploy.sh before a release
# that adds a migration; it takes no arguments.
#
#   1. pg_dump of DATABASE_NAME in the custom format, run in the postgres container, piped straight
#      into age and encrypted to BACKUP_AGE_RECIPIENT, the owner's public key. The private key is
#      kept offline by the owner and is never needed here; no unencrypted dump touches the disk.
#   2. Uploaded to the Bunny Storage zone BACKUP_STORAGE_ZONE as postgres/<UTC time>.dump.age.
#   3. Retention: every backup younger than 14 days stays; of those from 14 days to three months
#      (92 days) the newest of each ISO week stays; older ones are removed. Other files are left.
#   4. Only then the Better Stack heartbeat BACKUP_HEARTBEAT_URL is pinged, so a missing ping is an
#      alert. A failure at any earlier step exits non-zero without it; a failed ping is reported
#      but does not undo the backup.
#
# Settings, from the production environment file (BACKUP_ENV_FILE, otherwise DEPLOY_ENV_FILE):
# POSTGRES_USER, DATABASE_NAME and the BACKUP_* values of infra/production/.env.example. They are
# checked before anything runs; no secret is printed.

set -euo pipefail
set -f

PREFIX=backup
# shellcheck source=infra/scripts/backup-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

DAY=86400
DAILY_DAYS=14
WEEKLY_DAYS=92

(($# == 0)) || fail "usage: backup.sh (no arguments; the settings come from the environment file)"

use_env_file
load POSTGRES_USER "$IDENTIFIER_PATTERN"
load DATABASE_NAME "$IDENTIFIER_PATTERN"
load_storage
load BACKUP_AGE_RECIPIENT '^age1[02-9ac-hj-np-z]{58}$'
load BACKUP_HEARTBEAT_URL '^https?://[^[:space:]"\\]+$'

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

now="$(date -u +%s)"
name="$(date -u -d "@$now" +%Y%m%dT%H%M%SZ).dump.age"

# --- Dump and encrypt ------------------------------------------------------------------------------

# Extensions are left out: they belong to the superuser, and restore.sh creates pgvector itself.
say "dumping and encrypting $DATABASE_NAME"
compose exec -T postgres pg_dump --username "$POSTGRES_USER" --dbname "$DATABASE_NAME" \
  --format custom --no-owner --no-privileges '--exclude-extension=*' </dev/null |
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/$name" ||
  fail "dumping or encrypting the database failed; nothing was uploaded"

# --- Upload ----------------------------------------------------------------------------------------

storage "uploading the backup" /dev/null "200 201" "$name" --upload-file "$work/$name"
say "uploaded postgres/$name"

# --- Retention -------------------------------------------------------------------------------------

listed=()
names="$(list_backups "$work/listing.json" | sort -r)"
[[ -z "$names" ]] || mapfile -t listed <<<"$names"
if ((${#listed[@]})); then
  stamps="$(printf '%s\n' "${listed[@]}" |
    sed -E 's/^(....)(..)(..)T(..)(..)(..)Z.*$/\1-\2-\3 \4:\5:\6 UTC/' |
    date -u -f - '+%s %G-%V')" || fail "reading the times of the backups failed"
  mapfile -t stamps <<<"$stamps"
fi

expired=()
declare -A weeks=()
for index in "${!listed[@]}"; do
  read -r taken week <<<"${stamps[$index]}"
  elapsed=$((now - taken))
  if ((elapsed < DAILY_DAYS * DAY)); then
    continue
  elif ((elapsed < WEEKLY_DAYS * DAY)) && [[ -z "${weeks[$week]:-}" ]]; then
    weeks[$week]=kept
  else
    expired+=("${listed[$index]}")
  fi
done

for old in "${expired[@]}"; do
  # Already gone (404) counts as removed.
  storage "removing the expired backup $old" /dev/null "200 404" "$old" --request DELETE
done
say "kept $((${#listed[@]} - ${#expired[@]})) backups, removed ${#expired[@]}"

# --- Heartbeat -------------------------------------------------------------------------------------

if status="$(request "the heartbeat" /dev/null -- "$BACKUP_HEARTBEAT_URL")" &&
  [[ "$status" == 2?? ]]; then
  say "done"
else
  say "the backup succeeded, but the heartbeat was not accepted (HTTP ${status:-none})"
fi
