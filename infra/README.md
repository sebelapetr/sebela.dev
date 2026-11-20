# infra

The production definition of sebela.dev (`docs/release-workflow.md`, `.plan/10-delivery/prd.md`). Development never uses these files; its stack is the root `compose.yaml` alone.

| Path                      | What it is                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `production/compose.yaml` | Production overrides of the root `compose.yaml`: published images, ports, restarts and logs     |
| `production/.env.example` | Every production setting, as a documented placeholder; the real file lives only on the server   |
| `nginx/sebela.dev.conf`   | Reference configuration of the Ploi-managed nginx site that proxies sebela.dev to the website   |
| `scripts/deploy.sh`       | The deployment and rollback, run only as the `deploy` user's forced SSH command or by the owner |

Later phase-10 issues add the backup and restore scripts and `crons.txt` here.

## The production stack

Phase 10 runs Postgres, the one-off migration, the API, the website and MCP Admin:

```sh
docker compose --file compose.yaml --file infra/production/compose.yaml \
  --env-file <production environment file> up --detach --wait
```

- **Images.** `ghcr.io/sebelapetr/sebela-api`, `sebela-web` and `sebela-mcp-admin`, each by its own tag (`API_IMAGE_TAG`, `WEB_IMAGE_TAG`, `MCP_ADMIN_IMAGE_TAG`), so a release changes only what it rebuilt. The migration runs the API image and finishes before the API starts. Nothing is built on the server.
- **Images run unprivileged** (`USER node`) with a `HEALTHCHECK`, the same check `compose.yaml` declares. The build context admits only the fictional demo seed and no environment file; `scripts/checks/image-content.mjs` refuses an image that contains an environment file other than the example, a `.context/` file or a seed other than the demo.
- **Addresses.** Only the website is published, on `WEB_HOST:WEB_PORT` — the host's loopback interface — where nginx proxies to it. Postgres, the API and MCP Admin have no host port; the website and MCP Admin reach the API by service name inside the Compose networks. The public edge therefore cannot reach the API's private content-write routes or MCP Admin, with or without a key.
- **Operation.** Long-running services restart unless stopped; every container logs to `json-file` logs rotated at 10 MB, five files.
- **Website switches.** `WEB_INDEXING=on` lets search engines index the site; empty (the default) sends `noindex, nofollow` on every page. Analytics use the website's existing Umami integration (`apps/web/AGENTS.md`, Configuration): `WEB_ANALYTICS_SCRIPT_URL` and `WEB_ANALYTICS_WEBSITE_ID` pass through unchanged, and both empty (the default) means no analytics.
- **Health.** The website's `/health` answers 200 only when the API and, through the API's `/health/ready`, Postgres answer; otherwise 503 with the failing part.

What CI proves before an image is published: `scripts/checks/production-stack.test.mjs` (the composition's policy, rendered from the example settings) and `scripts/checks/production-stack.e2e.mjs` (`pnpm test:production-stack`: the images built, checked for forbidden files and started as this composition with the demo seed, all healthy, only the website published, on loopback). The release workflow runs that smoke check on the very images it then publishes, with the complete-stack browser tests, before it pushes anything (`docs/release-workflow.md`, Images).

## Deployment

`scripts/deploy.sh` deploys a verified tag set or rolls back to the previous verified release (`docs/release-workflow.md`, Deployment). It runs from the server's checkout of this repository, as the `deploy` user, and accepts exactly one of:

```text
deploy api=<commit SHA> web=<commit SHA> mcp-admin=<commit SHA>
rollback
```

Anything else (an unknown service, a short or upper-case SHA, a service named twice or missing, any shell syntax, path or option) is refused before anything runs.

- **The forced command.** The release workflow's key is restricted to the script in the `deploy` user's `~/.ssh/authorized_keys`, so the key cannot open a shell, forward ports or run anything else. The script reads its input from `SSH_ORIGINAL_COMMAND` and ignores arguments. One line, with the server's paths in place of the placeholders:

  ```text
  command="DEPLOY_ENV_FILE=<production environment file> DEPLOY_STATE_DIR=<state folder> <checkout>/infra/scripts/deploy.sh",restrict ssh-ed25519 <public key> deploy@github-actions
  ```

  The script also reads `DEPLOY_BACKUP`, `DEPLOY_REGISTRY`, `DEPLOY_WAIT_TIMEOUT` and `COMPOSE_FILE` from its environment, so an SSH client must not be able to set them: the server's `sshd` keeps `PermitUserEnvironment no` (the default) and accepts no `AcceptEnv` pattern that matches `DEPLOY_*` or `COMPOSE_*`, and the key line has no `environment=` option.

- **The `deploy` user** may run `docker` (member of the `docker` group), owns the production environment file (mode 600) and the state folder, and has the checkout readable. Its forced-command key is used only by the workflow; the owner signs in with their own key.
- **State.** `DEPLOY_STATE_DIR` holds `releases`, the record of verified releases (one tag set per line, newest last), and the `lock` that keeps two deployments from running at once.
- **Settings** besides the two above, all optional: `DEPLOY_BACKUP` (the backup script, default `infra/scripts/backup.sh` of the checkout; while it does not exist a release that adds a migration is refused), `DEPLOY_REGISTRY` (default the registry of `production/compose.yaml`), `DEPLOY_WAIT_TIMEOUT` (seconds, default 300) and `COMPOSE_FILE`.
- **The checkout.** The script and the composition come from the server's checkout of `master`. A change to `infra/` or `compose.yaml` builds no image, so it reaches the server only when the owner updates that checkout (`git pull` as the checkout's owner); the next deployment then uses it.
- **Images** are public GHCR packages (Server preparation), so the server pulls without a registry login.
- **Rollback**, by the owner: signed in to the server with their own key, as the `deploy` user, `DEPLOY_ENV_FILE=<production environment file> DEPLOY_STATE_DIR=<state folder> <checkout>/infra/scripts/deploy.sh rollback` (the same settings as the forced-command line). It starts the previous verified release without running the migration, waits for health and drops the newest release from the record. A second rollback goes one more release back; images already removed from the server are pulled again from GHCR.
- **GitHub Environment `production`.** Deployment branches limited to `master`; secrets `DEPLOY_SSH_KEY` (the private key of the forced-command line), `DEPLOY_HOST` (the server's host name) and `DEPLOY_KNOWN_HOSTS` (the server's `known_hosts` line, from `ssh-keyscan` checked against the server's own fingerprint). No application secret is stored there.
- **Production smoke check.** After each deployment the workflow runs `scripts/release/production-smoke.mjs` against `https://sebela.dev`. The owner can run it at any time, with a real API key if wanted: `SMOKE_BASE_URL=https://sebela.dev [SMOKE_API_KEY=<key>] node scripts/release/production-smoke.mjs`.

## Server preparation

The owner's one-time steps (issue #236) are written here as that issue settles them. Facts this composition already relies on:

- **First start, in order.** (1) The production environment file is in place. (2) `docker compose ... up --detach --wait postgres` initialises the volume. (3) The superuser creates the `vector` extension and the application role (below). (4) `docker compose ... up --detach --wait` runs the migration, which must finish successfully before the API starts, then the API, the website and MCP Admin.
- **Production environment file.** Created from `production/.env.example`, mode 600, owner `deploy`; every `replace-with-...` value replaced. It never enters Git, an image or a log.
- **Database role and pgvector.** `POSTGRES_USER` is the cluster's superuser and only initialises the volume. Once, after the first start of Postgres, the superuser creates the `vector` extension in `DATABASE_NAME` and the application role `DATABASE_USER` that owns that database; the migration and the API connect only as that role.
- **nginx.** The Ploi site for `sebela.dev` with its Let's Encrypt certificate takes `nginx/sebela.dev.conf`, with the website's `WEB_PORT`, the certificate paths and the CDN edge address file in place of its placeholders.
- **GHCR packages.** The release workflow creates `sebela-api`, `sebela-web` and `sebela-mcp-admin` on its first publish, linked to the repository by their source label. Once, the owner sets each package's visibility to public in its package settings, so the server pulls without a registry login.
- **Analytics.** On the Umami Cloud account, the website is created for `sebela.dev`; its tracker script address (`https://cloud.umami.is/script.js`) goes into `WEB_ANALYTICS_SCRIPT_URL` and its website ID into `WEB_ANALYTICS_WEBSITE_ID`, both public values. They stay empty until the owner turns analytics on.

## Open points for the server preparation

### The visitor's address behind Bunny CDN

The nginx request budget counts per visitor only when nginx trusts Bunny's edges to name the visitor (`real_ip_header`, `set_real_ip_from`). The server preparation confirms which header Bunny sets for the visitor's address, creates the file of edge addresses the configuration includes from Bunny's published list, and decides how that list is refreshed. Until then the limit counts per CDN edge.

### MCP Admin over the SSH tunnel

The delivery PRD reaches MCP Admin through an authenticated SSH tunnel, while this composition publishes no MCP Admin port. A tunnel needs a target on the server: either a loopback-only MCP Admin port in this composition (a one-line override with its policy test), or the container's address on the Compose network. This is decided with the server preparation and the SSH-tunnel acceptance check.
