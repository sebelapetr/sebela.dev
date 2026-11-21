# 0024 — A deployment brings the server's checkout to the release commit

Status: accepted
Date: 2026-11-21

## Decision

- A deployment runs with the repository files of the release it deploys. The forced command's input names the release commit (`release=<SHA>`) beside the image tags; `infra/scripts/deploy.sh` fetches `origin` in the server's checkout, refuses a commit that is not on `origin/master` and a checkout with local modifications, checks the commit out detached and re-executes the checked-out script once, so the release's script and Compose files do the deployment.
- A rollback leaves the checkout as it is. The newer files stay compatible with the previous release's images by the same rule as migrations; a rollback across a change that breaks that rule is a manual step of the owner.

## Why

The first deployment showed that the checkout stayed at the commit it was cloned at while newer images were deployed, so a release that changed `compose.yaml`, `infra/production/compose.yaml` or `infra/scripts/` would have deployed with stale files (issue #237). Updating the checkout by hand after every such merge is easy to forget and breaks "a merge into `master` deploys" (decision 0023). Only commits on `origin/master` can be checked out, so the key still cannot run code of its own, and the only new network access is `git fetch` of the repository's own remote.

## Rejected

- The owner updating the checkout by hand (`git pull`) after every merge that changes those paths.
- Checking out the previous release's commit on a rollback: the record of verified releases holds image tags only, and keeping it that way keeps a rollback independent of Git.

## Relationship to earlier decisions

Refines the deployment of 0023. Earlier records remain unchanged.
