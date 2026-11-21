# 0023 — Incremental delivery on merge, behind the server's nginx, at sebela.dev

Status: accepted
Date: 2026-11-20

## Decision

- Delivery is built now (phase 10) and deploys what `master` holds. Phases 7, 8 and 9/9.1 each end with a delivery issue for their service; the launch with real data is the last HITL issue of phase 9.1.
- A merge into `master` deploys: GitHub Actions builds only the affected images natively for arm64, verifies the stack, pushes public per-service images to GHCR and deploys through a GitHub Environment over SSH, where a forced command allows only the deploy script. A version tag and release follow a successful deployment.
- The server's existing nginx, managed by its hosting panel, is the reverse proxy; no Traefik. The production domain is sebela.dev; sebelapetr.cz stays as it is.
- Backups every night and before deployments with migrations, encrypted with `age`, in a separate Bunny Storage Zone. Better Stack Uptime and Umami Cloud are used.

## Why

Delivering what already works exercises the pipeline, backups and rollback on a small system instead of on launch day. Merging into `master` is already the owner's deliberate, reviewed act, so a second manual tag adds nothing. Building on GitHub keeps the shared server's small system disk free. The server's existing nginx already owns ports 80/443 and the certificate on this server.

## Rejected

- One delivery phase at the end; separate delivery phases after every feature phase.
- Building images on the VPS, a self-hosted runner, private images with a registry token on the server.
- Traefik; a domain switch of sebelapetr.cz.

## Relationship to earlier decisions

Changes the release trigger, reverse proxy, domain and launch placement planned in the phase-10 draft and the overview PRD. Earlier records remain unchanged.
