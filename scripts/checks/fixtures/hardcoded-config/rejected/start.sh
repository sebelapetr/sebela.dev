#!/usr/bin/env bash
# Deliberately hard-coded configuration of a fictional start script.
set -euo pipefail
API_PORT=3001 node server.mjs
docker run -p 5440:5432 fixture-image
createdb fixture
psql -d fixture -c "select 1"
DATABASE_NAME=fixture node migrate.mjs
exec node app.mjs --port "${WEB_PORT:-3000}"
