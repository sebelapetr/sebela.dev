# Phase 10 — Continuous delivery

|             |                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Draft from the owner's phase-10 interview (2026-11-20); awaiting document approval                                                                 |
| Date        | 2026-11-20                                                                                                                                         |
| Parent      | `.plan/00-overview/prd.md`                                                                                                                         |
| Depends on  | Phases 1–5 (what `master` holds today: website, API, database, admin MCP). Runs in a third loop alongside phases 6/7 and 9                         |
| Followed by | A delivery issue at the end of phases 7, 8 and 9/9.1 adds each new service; the launch is the last HITL issue of phase 9.1                         |
| Result      | Every merge into `master` builds the affected images, verifies them, deploys them to the owner's VPS and can roll back; sebela.dev serves the site |

## Problem Statement

The website, API and admin MCP are built and reviewed, but nothing runs anywhere except on development checkouts. Deploying by hand would work once and make every later fix a manual, error-prone operation, and how software ships is part of what this repository demonstrates. Waiting until every AI phase is finished would put the first production deployment, backups and rollback all on launch day.

## Solution

Deliver incrementally. This phase builds the delivery foundation and deploys what `master` holds today. Later phases each end with one delivery issue that adds their service to the same pipeline and stack.

```text
merge into master
  -> GitHub Actions: detect affected services -> build only those images (native arm64) -> verify the stack
  -> push to GHCR (public images, per-service tags)
  -> GitHub Environment "production": SSH as user deploy (forced command)
       -> infra/scripts/deploy.sh: [backup if a migration is included] -> pull -> migrate -> recreate -> health -> rollback on failure
  -> version tag and GitHub release with a generated changelog
VPS (ARM64, shared): the server's nginx (TLS) -> 127.0.0.1 ports -> Compose stack (postgres, api, web, mcp-admin)
Bunny CDN in front of sebela.dev, as today
```

## User Stories

1. As the owner, I want merging a reviewed phase pull request into `master` to deploy it, so that releasing needs no extra manual step.
2. As the owner, I want only the services a change affects to be rebuilt and redeployed, so that releases are fast and unrelated services keep running untouched.
3. As the owner, I want the built images verified as a running stack before they reach the server, so that the absence of staging does not mean testing in production.
4. As the owner, I want a failed health check to roll back to the previous images automatically, so that a bad release does not leave the site down.
5. As the owner, I want one documented command to redeploy the previous verified release, so that I can undo a release that passed its health check but behaves badly.
6. As the owner, I want migrations to run once, before the new API starts, so that nothing runs against a half-migrated schema.
7. As the owner, I want a database backup every night and before every deployment that contains a migration, encrypted and stored away from the server, so that a bad migration or a lost server costs at most a day.
8. As the owner, I want restoring a backup rehearsed and documented, so that I know the backups work.
9. As the owner, I want the deployment history visible in GitHub and each release tagged with a changelog, so that every version says what changed.
10. As the owner, I want to be alerted when the site is down or the nightly backup did not run, so that I do not have to check by hand.
11. As the owner, I want secrets only on the server and in the production environment of GitHub, never in Git, images or logs, so that a public repository and public images leak nothing.
12. As the owner, I want the deploy key on GitHub able to run only the deploy script, so that a leaked key cannot open a shell on my server.
13. As the owner, I want admin MCP and private content writes reachable only through an SSH tunnel, so that administration has no public address.
14. As the owner, I want privacy-friendly analytics without a cookie banner, so that I see visits without tracking visitors.
15. As the owner, I want the first deployment to run with the demo seed and a documented command to clear it, so that I can load my real data through admin MCP when I am ready.
16. As the owner, I want search engines kept out until I switch indexing on, so that a half-filled site is not indexed.
17. As a visitor, I want the site served over HTTPS and fast, with at most a few seconds of interruption during a release.
18. As a technical evaluator, I want the pipeline, the production stack and the operating procedures in the repository, so that I can see how the project ships.

## Implementation Decisions

### Scope and the incremental model

- This phase deploys `postgres` (with pgvector), `api`, `web` and `mcp-admin`. The API is not publicly exposed yet: the website calls it server-side over the internal Docker network.
- Phases 7, 8 and 9/9.1 each end with a delivery issue that adds `ai-service`, `mcp-public` and the retrieval pieces (migrations, private storage zone, backup of approved originals, public search) to the stack, pipeline, backups and smoke checks. Phase 6 is a library and ships inside `ai-service`. Those issues are created when this foundation is merged.
- The launch (clearing the demo content, loading real data through admin MCP, the one-time roadmap import, switching indexing on, manual checks of pages and chat) is the last HITL issue of phase 9.1, not a separate phase.
- The production domain is **sebela.dev**. The old sebelapetr.cz stays as it is; no domain switch or redirects are part of the plan.

### Build and verification

- GitHub Actions only; the VPS never builds. Images are built natively on GitHub's arm64 runners for the ARM64 VPS.
- On a push to `master`, the workflow determines the affected services from the changed files and the workspace graph (the same affected-package logic CI uses); only those images are built. A change to shared packages rebuilds every service that depends on them. Unchanged services keep their current image tag.
- Images are tagged per service with the commit SHA and pushed to GHCR as **public** packages, so the server pulls without a registry credential.
- Before anything is pushed or deployed, the stack is started from the freshly built images (unchanged services from their current tags) with the demo seed and checked by the existing stack smoke and end-to-end checks with models faked. Only images that passed are pushed and deployed; the same images, not rebuilt ones.
- A CI check fails the build if an image contains an environment file other than `.env.example`, anything from `.context/`, the secrets file or a seed other than the fictional demo. Images run as a non-root user.

### Deployment

- A GitHub Environment `production` holds only what the connection needs: the deploy user's private SSH key, the host and its known-host fingerprint. Deployments appear in GitHub's deployment history. The environment is restricted to `master`.
- On the VPS a dedicated `deploy` user's authorized key runs only `infra/scripts/deploy.sh` through a forced command, with the requested service tags as its only input, validated by the script. No self-hosted runner.
- `deploy.sh`: take a backup when the release includes a new migration -> pull the new images -> run the one-off migration service -> recreate the changed services -> wait for health checks -> on failure redeploy the previous tags and report failure. An interruption of a few seconds is accepted; zero-downtime is not a goal.
- The script records the deployed tag of every service, so a documented rollback command can redeploy the previous verified release. Migrations are forward-only, so a schema-changing release must keep the previous version working against the new schema; the reviewer checks this on every migration (`docs/release-workflow.md`).
- After a successful deployment the workflow creates a version tag and a GitHub release with a changelog generated from Conventional Commits. Releases are not triggered by tags.
- Content changes are not releases; they go through the API.
- pgvector needs a one-time `CREATE EXTENSION vector` as the database superuser in production (worktrees get it from the harness since #230).

### Production stack

- `infra/` holds the production definition (owner-approved new top-level folder, added to `docs/repository-structure.md`): Compose production overrides (GHCR images, `127.0.0.1` port bindings, restart policies, health checks, `json-file` log rotation), an environment example with every production variable as a placeholder, a reference nginx site configuration, `crons.txt`, and the `deploy`, `backup` and `restore` scripts, with a README.
- **Reverse proxy:** the server's existing nginx managed by the server's hosting panel with its Let's Encrypt certificate, proxying `sebela.dev` to the website's local port, with security headers, compression and request limits. No Traefik. Bunny CDN stays in front, as today.
- **Networks:** Postgres, the API and admin MCP have no public address. Admin MCP and private content-write routes are reachable only through an authenticated SSH tunnel; authentication still applies. The public edge refuses them even with a valid key.
- **Indexing:** the website sends `noindex` until `WEB_INDEXING` is switched on in the production environment.
- **Analytics:** Umami Cloud, loaded only in production when its website ID is configured; never in worktrees, e2e or CI. The builder checks the current free-plan limits.
- **Demo content:** a documented maintenance command clears the demo content (after a backup and an explicit confirmation), leaving an empty, migrated database for the owner's real data.

### Configuration and secrets

- Production configuration and secrets live only in the server's production environment file (mode 600, owner `deploy`): database passwords, storage keys, the website invalidation secret, the Better Stack heartbeat URL and the `age` public key; later phases add their own keys (a separate production Anthropic key with its own provider spend limit, Voyage, Langfuse).
- The GitHub Environment holds only the SSH connection; the deploy workflow references no application secret. The repository's eval key is used only by the model-eval workflow.
- The owner keeps the `age` private key and the database superuser password offline.

### Backups

- `pg_dump` of the production database every night (cron, from `infra/crons.txt`) and before every deployment that contains a migration.
- Encrypted with `age` to the owner's public key, uploaded to a separate Bunny Storage Zone `sebela-backups` without a Pull Zone, with its own key. Retention: daily for 14 days, weekly for three months.
- From phase 9 the same job backs up approved knowledge originals and their source/approval metadata; the retrieval index is rebuilt, not backed up (phase 9's delivery issue).
- A restore is rehearsed into a temporary database and compared with the original before this phase is accepted, and the procedure is documented step by step. A backup that was never restored does not count.

### Monitoring

- Better Stack Uptime: checks of `https://sebela.dev` and of a website health route that also verifies the API and the database, plus a heartbeat monitor that alerts when the nightly backup does not report. Alerts by e-mail and the mobile app.
- Failed deployments and rollbacks are reported by GitHub Actions' own notifications.
- Container logs stay on the server with rotation.

## Testing Decisions

- Test-first for the deploy and backup scripts' decisions: tag validation, migration detection, rollback on a failed health check, refusal of an unknown service or malformed input, retention selection. Prior art: the harness's plain-Node tests and the stack smoke checks in `scripts/checks/`.
- The image content check and the affected-service detection are tested with fixtures.
- The pipeline is proven by using it: the first deployment with the demo seed, a deliberate release with a failing health check that must end with the previous version running, and the restore rehearsal.
- A scripted production smoke check: pages respond over HTTPS, the health route is green, the public edge refuses the API's private routes and admin MCP even with a valid key, and admin MCP authenticates through the SSH tunnel.

## Out of Scope

- `ai-service`, `mcp-public`, retrieval and their public addresses (delivery issues of phases 7, 8 and 9/9.1).
- The launch with real data (last HITL issue of phase 9.1); sebelapetr.cz and roadtoai.dev.
- Staging, zero-downtime or blue-green deployment, several servers, orchestration platforms, infrastructure as code for the server itself, a self-hosted runner, Traefik.
- Better Stack logs or telemetry, Langfuse (phase 7).

## Further Notes

- HITL, before the phase pull request is merged: prepare the server and accounts by the steps the loop writes in `infra/README.md` (deploy user and forced-command key, hosting-panel site, production environment file, `sebela-backups` zone and `age` key, Better Stack, Umami, the GitHub Environment, the pgvector extension).
- HITL, after the merge: the first deployment, the rollback test, the restore rehearsal and the SSH-tunnel check; closing it accepts the phase.
- Images are built on GitHub, so the VPS's small system disk only holds pulled images; the deploy script prunes images older than the previous release. Moving Docker's data root to the volume is deferred to a planned window if space runs short.
- Prior art: the owner's Booky monorepo (per-service image tags, release workflow).
