# 0028 — A merge that builds no image reaches the server with the next release

Status: accepted
Date: 2026-11-22

## Decision

Decisions [0023](0023-incremental-delivery-on-merge.md) and [0025](0025-deployment-brings-the-checkout-to-the-release.md) say that a merge into `master` deploys. Read that as: a merge deploys what it builds. A merge that changes only infrastructure files (the production composition, the scripts and configuration the deploy script uses) or only documentation builds no image, so it starts no deployment. It reaches the server with the next release that builds an image, because a deployment brings the checkout to that release's commit (0025).

## Why

Delivery builds and deploys only the affected images, and the checkout is updated by the deployment itself. Without a deployment nothing updates it, and the first reading of 0023 and 0025 suggested a different behaviour.

## Rejected

- Deploying on every merge, including ones without an image: it restarts services and runs a deployment for no change in what runs.
- A separate job that updates the server's checkout on infrastructure-only merges: a second path to the server beside the forced deploy command.

## Relationship to earlier decisions

Refines the reading of 0023 and 0025; both stay as written and are not rewritten.
