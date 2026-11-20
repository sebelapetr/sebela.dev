#!/usr/bin/env bash
# Restore of a backup made by backup.sh (docs/release-workflow.md, "Restore"; infra/README.md,
# "Restore"). The backups are encrypted to the owner's offline key, so this script never decrypts:
# the owner fetches a backup, decrypts it on their own machine and streams the dump back in.
#
#   restore.sh list                                   the backups in the zone, oldest first
#   restore.sh fetch <backup>                         one encrypted backup to standard output
#   restore.sh into <database> --confirm <database> [--replace] [--compare <database>]
#                                                     restores the dump on standard input
#   restore.sh drop <database> --confirm <database>   removes a rehearsal database
#
# `into` creates the database for DATABASE_USER (dropping it first only with --replace), creates
# the pgvector extension, restores the dump in one transaction and prints the row count of every
# table beside the source's: the database --compare names, otherwise DATABASE_NAME when the target
# is another database. Any difference exits non-zero. `drop` refuses DATABASE_NAME and POSTGRES_DB.
# Both need the database's name twice, the second time after --confirm.
#
# Settings, from the production environment file (BACKUP_ENV_FILE, otherwise DEPLOY_ENV_FILE):
# POSTGRES_USER, POSTGRES_DB, DATABASE_NAME, DATABASE_USER and, for list and fetch, the
# BACKUP_STORAGE_* values. No secret is printed.

set -euo pipefail
set -f

PREFIX=restore
# shellcheck source=infra/scripts/backup-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

USAGE="usage: restore.sh list | fetch <backup> | into <database> --confirm <database> \
[--replace] [--compare <database>] | drop <database> --confirm <database>"

usage() {
  say "$USAGE"
  exit 2
}

load_database_settings() {
  use_env_file
  load POSTGRES_USER "$IDENTIFIER_PATTERN"
  load POSTGRES_DB "$IDENTIFIER_PATTERN"
  load DATABASE_NAME "$IDENTIFIER_PATTERN"
  load DATABASE_USER "$IDENTIFIER_PATTERN"
}

# psql_in <database> <sql>: one statement as the superuser; standard input stays untouched for the
# dump.
psql_in() {
  compose exec -T postgres psql --username "$POSTGRES_USER" --dbname "$1" --no-psqlrc \
    --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$2" </dev/null
}

database_exists() {
  local found
  found="$(psql_in "$POSTGRES_DB" "SELECT 1 FROM pg_database WHERE datname = '$1'")" ||
    fail "checking for the database $1 failed"
  [[ "$found" == 1 ]]
}

# The row count of every table of a database, one `schema.table count` line each, sorted.
COUNT_SQL="SELECT format('%I.%I', table_schema, table_name) || ' ' || \
(xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', table_schema, \
table_name), false, true, '')))[1]::text FROM information_schema.tables \
WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') \
ORDER BY 1"

counts() {
  psql_in "$1" "$COUNT_SQL" || fail "counting the rows of $1 failed"
}

# check_name <database>: a plain identifier, or the usage.
check_name() {
  [[ "$1" =~ $IDENTIFIER_PATTERN ]] || usage
}

command="${1:-}"
(($#)) && shift

case "$command" in
  list)
    (($# == 0)) || usage
    use_env_file
    load_storage
    umask 077
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    list_backups "$work/listing.json"
    ;;

  fetch)
    (($# == 1)) || usage
    [[ "$1" =~ $BACKUP_NAME_PATTERN ]] || fail "not the name of a backup: $1"
    use_env_file
    load_storage
    umask 077
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    storage "fetching $1" "$work/backup" "200" "$1"
    cat "$work/backup"
    ;;

  into)
    (($# >= 3)) || usage
    target="$1"
    shift
    confirmation="" replace=no compare=""
    while (($#)); do
      case "$1" in
        --confirm)
          (($# >= 2)) || usage
          confirmation="$2"
          shift 2
          ;;
        --replace)
          replace=yes
          shift
          ;;
        --compare)
          (($# >= 2)) || usage
          compare="$2"
          shift 2
          ;;
        *) usage ;;
      esac
    done
    check_name "$target"
    [[ -z "$compare" ]] || check_name "$compare"
    [[ "$confirmation" == "$target" ]] || fail "--confirm must repeat the database's name; nothing changed"
    [[ "$compare" != "$target" ]] || fail "--compare must name another database than the target"

    load_database_settings
    [[ "$target" != "$POSTGRES_DB" ]] || fail "refusing to restore into the cluster's database $POSTGRES_DB"
    if [[ -z "$compare" && "$target" != "$DATABASE_NAME" ]]; then compare="$DATABASE_NAME"; fi

    if database_exists "$target"; then
      [[ "$replace" == yes ]] ||
        fail "the database $target exists; add --replace to drop and recreate it; nothing changed"
      say "dropping $target"
      psql_in "$POSTGRES_DB" "DROP DATABASE \"$target\" WITH (FORCE)" >/dev/null ||
        fail "dropping $target failed"
    fi
    say "creating $target for $DATABASE_USER"
    psql_in "$POSTGRES_DB" "CREATE DATABASE \"$target\" OWNER \"$DATABASE_USER\"" >/dev/null ||
      fail "creating $target failed"
    psql_in "$target" "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null ||
      fail "creating the vector extension in $target failed"

    say "restoring the dump from standard input into $target"
    compose exec -T postgres pg_restore --username "$POSTGRES_USER" --dbname "$target" \
      --no-owner --role "$DATABASE_USER" --exit-on-error --single-transaction ||
      fail "the restore into $target failed; nothing of it was kept"

    restored="$(counts "$target")"
    if [[ -z "$compare" ]]; then
      printf '%-60s %12s\n' table rows
      while read -r table rows; do
        if [[ -n "$table" ]]; then printf '%-60s %12s\n' "$table" "$rows"; fi
      done <<<"$restored"
      say "restored into $target"
      exit 0
    fi

    source_counts="$(counts "$compare")"
    declare -A restored_rows=() source_rows=()
    while read -r table rows; do
      if [[ -n "$table" ]]; then restored_rows[$table]="$rows"; fi
    done <<<"$restored"
    while read -r table rows; do
      if [[ -n "$table" ]]; then source_rows[$table]="$rows"; fi
    done <<<"$source_counts"
    tables="$(printf '%s\n' "${!restored_rows[@]}" "${!source_rows[@]}" | sort -u)"
    differing=()
    printf '%-60s %12s %12s\n' table "$target" "$compare"
    while read -r table; do
      [[ -n "$table" ]] || continue
      ours="${restored_rows[$table]:--}" theirs="${source_rows[$table]:--}"
      printf '%-60s %12s %12s\n' "$table" "$ours" "$theirs"
      [[ "$ours" == "$theirs" ]] || differing+=("$table")
    done <<<"$tables"
    ((${#differing[@]} == 0)) ||
      fail "the row counts of $target and $compare differ: ${differing[*]}"
    printf 'The row counts of %s and %s are equal.\n' "$target" "$compare"
    ;;

  drop)
    (($# == 3)) && [[ "$2" == --confirm ]] || usage
    check_name "$1"
    [[ "$3" == "$1" ]] || fail "--confirm must repeat the database's name; nothing changed"
    load_database_settings
    [[ "$1" != "$DATABASE_NAME" && "$1" != "$POSTGRES_DB" ]] ||
      fail "refusing to drop $1: only a rehearsal database can be dropped"
    if database_exists "$1"; then
      psql_in "$POSTGRES_DB" "DROP DATABASE \"$1\" WITH (FORCE)" >/dev/null || fail "dropping $1 failed"
      say "dropped $1"
    else
      say "there is no database $1"
    fi
    ;;

  *) usage ;;
esac
