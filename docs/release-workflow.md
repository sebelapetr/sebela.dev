# Release workflow

Skeleton. The content is defined in phase 10 (`.plan/10-delivery/prd.md`).

## Decided so far

- Delivery starts in phase 10 on sebela.dev; the public launch with real data is the last step of phase 9.1, and the old sebelapetr.cz stays as it is. Knowledge graph, ontology and external MCP UI are separate later phases, not first-release gates.
- Deployment target is the owner's VPS, with Docker: one image per app and one Compose stack, the same composition as locally.
- Migrations run as a dedicated step before the API starts, never from the API on startup. There are no down migrations: fix forward, back up before deploying.
- Content changes do not need a release; they go through the API.
- A merge into `master` deploys; a version tag `vX.Y.Z` and a GitHub release follow a successful deployment. Production only; there is no staging environment.
- Before deployment the pipeline starts the complete stack from the built images with the demo seed and runs the end-to-end tests. Only images that passed are deployed.
- A failed deployment rolls back to the previous version. Because migrations are forward-only, **a release that changes the schema must keep the previous version working** against the new schema.
- Backups: before every deployment and nightly, stored away from the server; a restore is rehearsed before launch.

## Production stack

Defined in `infra/` (details and server preparation: `infra/README.md`).

- **Composition.** The root `compose.yaml` with the overrides of `infra/production/compose.yaml`, started with the server's production environment file, created from `infra/production/.env.example`. Phase 10 runs Postgres, the one-off migration, the API, the website and MCP Admin.
- **Images.** `ghcr.io/sebelapetr/sebela-api`, `sebela-web` and `sebela-mcp-admin`, each with its own tag (`API_IMAGE_TAG`, `WEB_IMAGE_TAG`, `MCP_ADMIN_IMAGE_TAG`). Nothing is built on the server. Every image runs unprivileged with a `HEALTHCHECK`, and contains only the fictional demo seed and no environment file other than the example; `scripts/checks/image-content.mjs` refuses one that does not.
- **Addresses.** Only the website is published, on the host's loopback interface (`WEB_HOST:WEB_PORT`). Postgres, the API and MCP Admin have no host port, so the public edge cannot reach the private content-write routes or MCP Admin, with or without a key.
- **Operation.** Long-running services restart unless stopped; logs are `json-file`, rotated at 10 MB, five files.
- **Reverse proxy and TLS.** The server's Ploi-managed nginx terminates TLS with Let's Encrypt and proxies to the website; its reference configuration (redirects, the visitor's address behind Bunny CDN, request limits, security headers, compression) is `infra/nginx/sebela.dev.conf`.
- **Website switches.** `WEB_INDEXING=on` allows indexing; by default every page sends `noindex`. Analytics use the website's existing Umami settings (`WEB_ANALYTICS_SCRIPT_URL`, `WEB_ANALYTICS_WEBSITE_ID`), passed through unchanged and off while empty; their production values are set in the server preparation.
- **Health.** The website's `/health` answers 200 only when the API and Postgres (through the API's `/health/ready`) answer, otherwise 503 with the failing part.
- **Verified in CI** by the production composition policy (`scripts/checks/production-stack.test.mjs`) and the production stack smoke check (`pnpm test:production-stack`, `docs/testing.md`, CI).

## Images

Built, verified and published by `.github/workflows/release.yml` on every push to `master`; the decisions are `scripts/release/images.mjs`, tested with fixtures (`docs/testing.md`, CI).

- **What is built.** The services are `api`, `web` and `mcp-admin`. Each is judged against the commit of its current image (below), not against the previous push, so a change whose own release failed or was cancelled is built by the next release. A service is built when Turborepo's affected packages between that commit and the pushed commit include its app, the selection CI uses, so a change to a shared package rebuilds every service that depends on it. A change to `.dockerignore` or the root `package.json`, which enter every image build without selecting an app, builds every service; so does a service that has no current image yet. A push that changes no image (documentation, `.plan/`, a workflow alone) builds, publishes and deploys nothing.
- **Tags.** Each image built is tagged with the full commit SHA and labelled with it (`org.opencontainers.image.revision`) and with the repository (`org.opencontainers.image.source`). The tag `current` names the last verified image of each service published from `master`.
- **Unchanged services.** They keep their `current` image, by the commit SHA in its revision label. A service whose current image names no published commit tag is built with the others.
- **Never backwards.** A release whose commit does not descend from the commit of a current image is refused, when it is planned and again just before it publishes: a rerun of an older release cannot move `current` back.
- **Built natively** on GitHub's arm64 runners, the server's architecture; nothing is built on the server.
- **Verified before publishing.** The new images and the current images of the unchanged services start as the production composition with the demo seed, and the production stack smoke check and the complete-stack browser tests run against it, with the model faked (the mock Ask page). Images that fail are never pushed.
- **Published** to GHCR as public packages: the commit SHA tags first, then `current`. The workflow's only credential is its `GITHUB_TOKEN`, with `packages: write` only in that job; the Docker sign-in to GHCR exists only around pulling the reused images and publishing, not during the builds and tests. The tag set of every service is the job's output `tags` (JSON, service to tag) for the deployment.
- **One release at a time.** GitHub lets the running release finish and cancels a release still waiting when a newer push queues. Nothing is lost by that: the newer release builds everything that changed since the current images.
- **`current` moves on publishing**, before the images are deployed. A failed deployment therefore leaves `current` on images that are not running; the next release still builds everything that changed since them, and the server runs whatever its record of verified releases names (Deployment).

## Deployment

The `deploy` job of `.github/workflows/release.yml` runs after the images are published, in the GitHub Environment `production` (deployment branches: `master` only). Its only secrets are the SSH key, the host and the server's known-host line; it references no application secret. It sends the images job's tag set over SSH to the `deploy` user, whose key is restricted to the forced command `infra/scripts/deploy.sh` (the `authorized_keys` line, the server settings and the state are in `infra/README.md`, Deployment).

- **Input.** Only `deploy api=<SHA> web=<SHA> mcp-admin=<SHA>` (every service once, full 40-character commit SHAs, `scripts/release/deployment.mjs input`) or `rollback`. Anything else is refused before anything runs; the key can do nothing else. One deployment at a time (a lock on the server).
- **Steps.** (1) Pull the release's images; nothing that runs changes. (2) Compare the migration files of the new API image with those of the running release: a new migration, or no verified release yet, needs a backup first; while the backup script is missing (#235) such a release is refused and nothing changes. (3) Run the one-off migration once. (4) Recreate the services whose image changed and wait until every service is healthy.
- **Failure.** When the migration or the health check fails, the script starts the previous verified release again, waits for it to be healthy and exits non-zero, so the job fails and no version is tagged.
- **Record.** A healthy release is appended to the server's record of verified releases, one tag set per line. Images of the three services that are in neither of the last two records are removed from the server; the previous release stays available for a rollback.
- **Rollback.** `ssh deploy@<host> rollback` with the deployment key, or `infra/scripts/deploy.sh rollback` on the server as `deploy` (`infra/README.md`, Deployment): starts the previous verified release, waits for health and drops the newest release from the record. It runs no backup and applies no migration; the older release runs on the newer schema by the compatibility rule below.
- **Smoke check.** After a deployment the job runs `scripts/release/production-smoke.mjs` against `https://sebela.dev`: the public pages answer with HTML, the website's `/health` is green, and the edge refuses the API's private routes, MCP Admin and the website's internal routes even with a key. The workflow holds no application secret, so it sends a made-up key; the owner can repeat the check with a real one.
- **Infrastructure changes.** The script and the composition come from the server's checkout of `master`. A change to `infra/` or `compose.yaml` releases no image; it reaches the server when the owner updates that checkout, and the next deployment uses it.
- **Verified in CI** by the input, migration, backup, rollback and record tests (`scripts/release/deploy.test.mjs`, against a faked Docker) and by a simulated deployment of the real script against a disposable Compose project, where a deliberately unhealthy release ends with the previous one running (`scripts/release/deploy.e2e.mjs`, `docs/testing.md`, CI).

### Migration compatibility rule

Migrations are forward-only, and a rollback or a failed deployment runs the previous release on the new schema. Every migration must therefore keep the previous release working: expand first (add tables, nullable or defaulted columns, new indexes), and remove or rename what the previous release still uses only in a later release, once no verified release that may be rolled back to depends on it (expand/contract). A release that adds a migration is backed up before the migration runs.

## Versions

After a healthy deployment and smoke check the `release` job tags the commit with the next version `vX.Y.Z` and publishes a GitHub release (`scripts/release/deployment.mjs notes`).

- **Next version** from the Conventional Commits since the last version tag merged into the commit: a breaking change (`!` or a `BREAKING CHANGE` footer) raises the major, a `feat` the minor, anything else the patch. Counting starts at `v0.0.0`, so the first release is `v0.1.0` when it contains a feature.
- **Release notes** list the commits since that tag, grouped as breaking changes, features, fixes and other changes, followed by the deployed image tags.
- A failed deployment publishes no version; the next healthy one includes its commits.

## To be defined in phase 10

- How MCP Admin is reached through the SSH tunnel, and how nginx learns the visitor's address from Bunny CDN (`infra/README.md`, Open points)
- Database backups and restore procedure (#235; until then a release that adds a migration is refused)
- The domain switch

## First-release scope

Phase 10 deploys the website, the API and authenticated internal/SSH-tunnel administration; phases 7, 8 and 9/9.1 add live structured-data chat, public MCP and approved-source RAG through their delivery issues, and the launch with real data closes phase 9.1. Graph, ontology and external interactive MCP UI are post-launch phases 11–13, not launch gates.

The public reverse proxy must not expose private content-write API routes as an alternative to Admin MCP. Backups include privately stored knowledge originals and source/approval metadata; rehearse restoration and retrieval rebuild as well as database restore. Private originals never receive a public CDN/static-file mapping. Later releases preserve these boundaries and the forward-compatible migration/rollback rule.
