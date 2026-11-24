#!/usr/bin/env bash
# Clears the fictional demo content from the production database before the real content is
# entered (docs/release-workflow.md, "Clearing the demo content"; infra/README.md):
#
#   clear-demo.sh --confirm <database>
#
# <database> must be DATABASE_NAME of the production environment file. A backup (backup.sh, or
# CLEAR_BACKUP) runs first; only when it succeeds does the API image's clear-content command empty
# the profile and the AI roadmap and delete their media files. The migrations, API keys and the
# audit stay, so the database is empty, migrated and ready for content.
#
# Settings: the production environment file (BACKUP_ENV_FILE, otherwise DEPLOY_ENV_FILE), as for
# backup.sh.

set -euo pipefail
set -f

PREFIX=clear-demo
# shellcheck source=infra/scripts/backup-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

if (($# != 2)) || [[ "$1" != --confirm || -z "$2" ]]; then
  say "usage: clear-demo.sh --confirm <database>"
  exit 2
fi

use_env_file
load DATABASE_NAME "$IDENTIFIER_PATTERN"
[[ "$2" == "$DATABASE_NAME" ]] ||
  fail "the confirmation does not match DATABASE_NAME; nothing was backed up or cleared"

BACKUP="${CLEAR_BACKUP:-$SCRIPT_DIR/backup.sh}"
say "backing up the database first"
"$BACKUP" </dev/null || fail "the backup failed; nothing was cleared"

say "clearing the demo content of the database"
compose exec -T api node dist/cli/clear-content.js --confirm "$DATABASE_NAME" </dev/null ||
  fail "clearing the content failed; the backup just taken holds what was there"
say "done: the database is empty and migrated"
