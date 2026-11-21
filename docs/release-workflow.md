# Release workflow

How sebela.dev is built, deployed, backed up and restored (`.plan/done/10-delivery/prd.md`). The commands and the server's one-time preparation are in `infra/README.md`.

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
- **Reverse proxy and TLS.** The server's nginx managed by the server's hosting panel terminates TLS with Let's Encrypt and proxies to the website; its reference configuration (redirects, the visitor's address behind Bunny CDN, request limits, security headers, compression) is `infra/nginx/sebela.dev.conf`.
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
- **Attested.** Every image a release pushes gets, for its pushed digest, a signed [SLSA build provenance](https://slsa.dev/provenance/) attestation (`actions/attest-build-provenance`) and an attestation of its SPDX SBOM (generated from the pushed image by `anchore/sbom-action`, attested by `actions/attest`); both are pushed to GHCR beside the image. `publish` prints the pushed digests as the job's step output `digests` (JSON, service to `sha256:...`), and only those images are attested: a reused image keeps the attestations of the release that built it. The job signs with its OIDC token, so `id-token: write` and `attestations: write`, like `packages: write`, exist only in that job. Anyone can verify an image and read its SBOM with the GitHub CLI:

  ```sh
  # The provenance: built by this repository's release workflow, from the commit in the tag.
  gh attestation verify oci://ghcr.io/sebelapetr/sebela-api:<sha> --owner sebelapetr
  # The SBOM: verify its attestation and print the SPDX document.
  gh attestation verify oci://ghcr.io/sebelapetr/sebela-api:<sha> --owner sebelapetr \
    --predicate-type https://spdx.dev/Document/v2.3 --format json \
    --jq '.[].verificationResult.statement.predicate'
  ```

  The same works for `sebela-web` and `sebela-mcp-admin`, and for the `current` tag. Adding `--signer-workflow sebelapetr/sebela.dev/.github/workflows/release.yml` also checks that the release workflow, not another workflow of the repository, built it.

- **One release at a time.** GitHub lets the running release finish and cancels a release still waiting when a newer push queues. Nothing is lost by that: the newer release builds everything that changed since the current images.
- **`current` moves on publishing**, before the images are deployed. A failed deployment therefore leaves `current` on images that are not running; the next release still builds everything that changed since them, and the server runs whatever its record of verified releases names (Deployment).

## Deployment

The `deploy` job of `.github/workflows/release.yml` runs after the images are published, in the GitHub Environment `production` (deployment branches: `master` only). Its only secrets are the SSH key, the host and the server's known-host line; it references no application secret. It sends the release commit and the images job's tag set over SSH to the `deploy` user, whose key is restricted to the forced command `infra/scripts/deploy.sh` (the `authorized_keys` line, the server settings and the state are in `infra/README.md`, Deployment).

- **Input.** Only `deploy release=<SHA> api=<SHA> web=<SHA> mcp-admin=<SHA>` (the release commit and every service once, full 40-character commit SHAs, `scripts/release/deployment.mjs input`) or `rollback`. Anything else is refused before anything runs; the key can do nothing else. One deployment at a time (a lock on the server).
- **Steps.** (0) Bring the server's checkout to the release commit and run that commit's script (Repository files, below). (1) Pull the release's images; nothing that runs changes. (2) Compare the migration files of the new API image with those of the running release: a new migration, or no verified release yet, needs a backup first (`infra/scripts/backup.sh`, Backups); when it fails, or no backup script is there, the release is refused and nothing changes. (3) Run the one-off migration once, as its own step. (4) Recreate the services whose image changed and wait until every service is healthy; this starts Postgres, the API, the website and MCP Admin by name without their dependencies, so the migration does not run a second time.
- **Failure.** When the migration or the health check fails, the script starts the previous verified release again, waits for it to be healthy and exits non-zero, so the job fails and no version is tagged.
- **Record.** A healthy release is appended to the server's record of verified releases, one tag set per line. Images of the three services that are in neither of the last two records are removed from the server; the previous release stays available for a rollback.
- **Rollback.** The owner, signed in to the server with their own key, runs `infra/scripts/deploy.sh rollback` as `deploy` with the settings of the forced-command line (the exact command is in `infra/README.md`, Deployment; the deployment key belongs to the workflow alone). It starts the previous verified release, waits for health and drops the newest release from the record. It runs no backup and applies no migration; the older release runs on the newer schema by the compatibility rule below.
- **Smoke check.** After a deployment the job runs `scripts/release/production-smoke.mjs` against `https://sebela.dev`: the public pages answer with HTML, the website's `/health` is green, and the edge refuses the API's private routes, MCP Admin and the website's internal routes even with a key. The workflow holds no application secret, so it sends a made-up key; the owner can repeat the check with a real one.
- **Repository files.** A deployment runs with the repository files of the release it deploys. The script fetches `origin` in the server's checkout, refuses a release commit that is not on `origin/master` and a checkout with local modifications (nothing changes either way), checks the commit out detached and re-executes the checked-out `infra/scripts/deploy.sh` once, so the release's script, Compose files and backup script do the rest. A change to `infra/` or `compose.yaml` releases no image but reaches the server with the deployment of its own push; nobody updates the checkout by hand. A rollback leaves the checkout at the release it rolls back from; the newer files stay compatible with the previous release by the rule below (`infra/README.md`, Deployment).
- **Verified in CI** by the input, checkout, migration, backup, rollback and record tests (`scripts/release/deploy.test.mjs`, against a faked Docker and a temporary checkout with a bare origin of its own) and by a simulated deployment of the real script against a disposable Compose project, where a deliberately unhealthy release ends with the previous one running (`scripts/release/deploy.e2e.mjs`, `docs/testing.md`, CI).

## Backups

`infra/scripts/backup.sh` runs nightly (`infra/crons.txt`, 02:30 UTC) and before every deployment that adds a migration (Deployment, step 2).

- **Encrypted off the server.** A `pg_dump` of the production database is piped straight into `age`, encrypted to the owner's public key, and uploaded to the Bunny Storage zone `sebela-backups`; no unencrypted dump is written to disk. The private key stays offline with the owner and is never needed on the server, so neither the server nor the zone can read a backup.
- **Retention.** Daily for 14 days; then the newest of each ISO week up to three months; older backups are removed.
- **Monitored.** Only a complete backup (dump, upload and retention) pings the Better Stack heartbeat; a failure exits non-zero without it, so a missing backup alerts within a day.
- **Scope.** The database only. Uploaded media live in their own Bunny Storage zone, off the server; the later phases' private knowledge originals are added to the backups by the phase that stores them (First-release scope).
- **Extensions.** The dump leaves extensions out, because they belong to the superuser; `restore.sh into` creates `vector` itself. A later phase that adds another extension must add it to `restore.sh` too.
- **No secret in logs.** The scripts print no password, key or heartbeat address.

## Restore

`infra/scripts/restore.sh` lists and fetches the encrypted backups. The owner decrypts a backup on their own machine and streams the dump back over SSH into a chosen database, which `restore.sh into` creates for the application role, restores in one transaction and compares table by table with the source's row counts, failing on any difference. Every destructive step needs the database's name repeated after `--confirm`; an existing database is replaced only with `--replace`, and `drop` removes only a rehearsal database.

- **Rehearsal.** Before the launch, and after any change to the scripts, the latest backup is restored into a temporary database, its counts are compared with production and it is dropped.
- **Recovering production.** Stop the API, the website and MCP Admin, restore into the production database with `--replace` comparing against a rehearsal restored from the same backup, then start the release whose schema matches the backup (Rollback).
- **Verified in CI** by the decision tests against a faked Docker, curl and storage (`scripts/release/backup.test.mjs`: settings, retention selection, failures without the heartbeat, no secret printed; `restore.test.mjs` and `clear-demo.test.mjs`: the confirmations and refusals) and by a round trip with the real scripts and the real `age` against a disposable Postgres of the production image and a fake storage zone: dump, encrypt, upload, fetch, decrypt, restore, equal row counts and vectors (`scripts/release/backup.e2e.mjs`, `docs/testing.md`, CI).

## Clearing the demo content

Production starts with the fictional demo seed. Before the real content is entered, `infra/scripts/clear-demo.sh --confirm <database>` backs up first and, only when that succeeds, runs the API's `clear-content` maintenance command: every table of the profile and the AI roadmap is emptied and their stored media files are deleted. The migrations, API keys and the audit stay, so the database is empty, migrated and ready for content. The confirmation must name the production database.

## Migration compatibility rule

Migrations are forward-only, and a rollback or a failed deployment runs the previous release on the new schema. Every migration must therefore keep the previous release working: expand first (add tables, nullable or defaulted columns, new indexes), and remove or rename what the previous release still uses only in a later release, once no verified release that may be rolled back to depends on it (expand/contract). A release that adds a migration is backed up before the migration runs.

The reviewer checks this rule on every pull request that adds a migration (`packages/db/AGENTS.md`, Migrations): a migration that drops, renames or tightens something the previous release still reads or writes is an objection, unless the change is split into an expand release and a later contract release.

## Versions

After a healthy deployment and smoke check the `release` job tags the commit with the next version `vX.Y.Z` and publishes a GitHub release (`scripts/release/deployment.mjs notes`).

- **Next version** from the Conventional Commits since the last version tag merged into the commit: a breaking change (`!` or a `BREAKING CHANGE` footer) raises the major, a `feat` the minor, anything else the patch. Counting starts at `v0.0.0`, so the first release is `v0.1.0` when it contains a feature.
- **Release notes** list the commits since that tag, grouped as breaking changes, features, fixes and other changes, followed by the deployed image tags.
- A failed deployment publishes no version; the next healthy one includes its commits.
- A rerun of an already released commit (the deployment rerun after a rollback test, say) publishes no new version: when a version tag already points at the commit, the `release` job says so in its log and step summary and tags nothing.

## To be defined in phase 10

- How MCP Admin is reached through the SSH tunnel, and how nginx learns the visitor's address from Bunny CDN (`infra/README.md`, Open points)
- The domain switch

## First-release scope

Phase 10 deploys the website, the API and authenticated internal/SSH-tunnel administration; phases 7, 8 and 9/9.1 add live structured-data chat, public MCP and approved-source RAG through their delivery issues, and the launch with real data closes phase 9.1. Graph, ontology and external interactive MCP UI are post-launch phases 11–13, not launch gates.

The public reverse proxy must not expose private content-write API routes as an alternative to Admin MCP. Backups include privately stored knowledge originals and source/approval metadata; rehearse restoration and retrieval rebuild as well as database restore. Private originals never receive a public CDN/static-file mapping. Later releases preserve these boundaries and the forward-compatible migration/rollback rule.
