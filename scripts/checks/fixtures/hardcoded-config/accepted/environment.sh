#!/usr/bin/env bash
# Configuration read from the environment. A comment may say: createdb fixture on localhost:5440.
set -euo pipefail
: "${API_PORT:?API_PORT must be set}"
API_PORT="$API_PORT" node server.mjs
docker run -p "$POSTGRES_PORT:5432" fixture-image
createdb "$DATABASE_NAME"
psql -d "$DATABASE_NAME" -c "select 1"
if [ -d "$WORK_DIR" ]; then echo "found"; fi
exec node app.mjs --port "${WEB_PORT}"
