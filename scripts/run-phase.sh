#!/usr/bin/env bash
# Runs a phase unattended. See docs/agents.md ("The phase loop").
#   scripts/run-phase.sh <phase-folder> [--base <branch>] [--wait-minutes N] [--max-failures N]
set -euo pipefail
exec node "$(dirname "$0")/harness/run-phase.mjs" "$@"
