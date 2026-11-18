#!/usr/bin/env bash
# Runs a phase unattended. See docs/agents.md ("The phase loop").
#   harness/run-phase.sh <phase-folder> [--base <branch>] [--wait-minutes N] [--max-failures N] [--note "<text>"]
set -euo pipefail
exec node "$(dirname "$0")/run-phase.mjs" "$@"
