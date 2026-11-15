#!/usr/bin/env bash
# One-off GitHub set-up for the harness: labels and protection of master.
# Outward-facing: run it only with the owner's approval. Safe to run again.
#   scripts/harness/setup-github.sh
set -euo pipefail

label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null; echo "label $1"; }

label "ready-for-agent" "0e8a16" "Approved breakdown; an agent may take it"
label "afk"             "c5def5" "Can be finished by agents alone"
label "hitl"            "fbca04" "Needs the owner: a decision or a design review"
label "agent-retry"     "f9d0c4" "Failed once in the phase loop; one more attempt"
label "agent-failed"    "b60205" "Failed twice in the phase loop; skipped until the owner looks"
label "trial"           "bfdadc" "Practice issue of the harness trial; never merged"

for phase in 00-trial 01-foundation 02-api-db 03-web 04-ai-roadmap 05-mcp-admin 06-rag-memory 07-llm-agent 08-delivery; do
  label "phase:$phase" "5319e7" "Issue of phase $phase"
done

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api --method PUT "repos/$repo/branches/master/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": false, "contexts": ["Harness tests"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
echo "master protected: pull request with green CI required for everyone (admins too), no force-push, no deletion"
