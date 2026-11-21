# infra

The production definition of sebela.dev (`docs/release-workflow.md`, `.plan/done/10-delivery/prd.md`). Development never uses these files; its stack is the root `compose.yaml` alone.

| Path                              | What it is                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `production/compose.yaml`         | Production overrides of the root `compose.yaml`: published images, ports, restarts and logs                            |
| `production/.env.example`         | Every production setting, as a documented placeholder; the real file lives only on the server                          |
| `nginx/sebela.dev.conf`           | Reference configuration of the nginx managed by the server's hosting panel site that proxies sebela.dev to the website |
| `scripts/deploy.sh`               | The deployment and rollback, run only as the `deploy` user's forced SSH command or by the owner                        |
| `scripts/backup.sh`               | The encrypted backup of the production database to the `sebela-backups` zone, with retention                           |
| `scripts/restore.sh`              | Lists and fetches backups and restores a decrypted dump into a chosen database, comparing rows                         |
| `scripts/clear-demo.sh`           | Backs up, then clears the fictional demo content, leaving an empty, migrated database                                  |
| `scripts/bunny-edge-addresses.sh` | Writes the Bunny CDN edge addresses nginx trusts for the visitor's address, then tests and reloads nginx (root, daily) |
| `scripts/backup-common.sh`        | The settings and storage helpers the three scripts above share (sourced, never run)                                    |
| `crons.txt`                       | The server's scheduled jobs, entered once in the hosting panel: the nightly backup                                     |
| `pnpm/`                           | pnpm for the API, website and MCP Admin images: a manifest and npm lockfile installed with `npm ci` (below)            |

## The production stack

Phase 10 runs Postgres, the one-off migration, the API, the website and MCP Admin:

```sh
docker compose --file compose.yaml --file infra/production/compose.yaml \
  --env-file <production environment file> up --detach --wait
```

- **Images.** `ghcr.io/sebelapetr/sebela-api`, `sebela-web` and `sebela-mcp-admin`, each by its own tag (`API_IMAGE_TAG`, `WEB_IMAGE_TAG`, `MCP_ADMIN_IMAGE_TAG`), so a release changes only what it rebuilt. The migration runs the API image and finishes before the API starts. Nothing is built on the server.
- **Images run unprivileged** (`USER node`) with a `HEALTHCHECK`, the same check `compose.yaml` declares. The build context admits only the fictional demo seed and no environment file; `scripts/checks/image-content.mjs` refuses an image that contains an environment file other than the example, a `.context/` file or a seed other than the demo.
- **pnpm in the images.** The images install pnpm with `npm ci --prefix /opt/pnpm` from `pnpm/package.json` and `pnpm/package-lock.json`, not with `npm install --global`, so npm verifies pnpm and its platform-specific native executables against the lockfile's integrity hashes on every architecture, as the base image is pinned by digest. `scripts/checks/image-pnpm.test.mjs` keeps the version equal to `packageManager` in the root `package.json` and refuses an `npm install` in a Dockerfile. To upgrade pnpm, change `packageManager` and the version in `pnpm/package.json`, then run `npm install --package-lock-only --ignore-scripts` in `pnpm/`. Dependabot does not update it: its npm updates are not set up, and a version apart from `packageManager` would fail the check.
- **Addresses.** The website is published on `WEB_HOST:WEB_PORT` and MCP Admin on `MCP_ADMIN_HOST:MCP_ADMIN_PORT`, both on the host's loopback interface: nginx proxies only to the website, and MCP Admin is reached only through the owner's SSH tunnel (`ssh -N -L <local port>:127.0.0.1:<MCP_ADMIN_PORT> <server>`), with its API key still required. Postgres and the API have no host port; the website and MCP Admin reach the API by service name inside the Compose networks. The public edge therefore cannot reach the API's private content-write routes or MCP Admin, with or without a key.
- **Project.** The composition is the Compose project `sebela-production` (its own `name`), so its containers, networks and volume never mix with the development stack `sebela` of the root file, also on a host that runs both.
- **Operation.** Long-running services restart unless stopped; every container logs to `json-file` logs rotated at 10 MB, five files.
- **Website switches.** `WEB_INDEXING=on` lets search engines index the site; empty (the default) sends `noindex, nofollow` on every page. Analytics use the website's existing Umami integration (`apps/web/AGENTS.md`, Configuration): `WEB_ANALYTICS_SCRIPT_URL` and `WEB_ANALYTICS_WEBSITE_ID` pass through unchanged, and both empty (the default) means no analytics.
- **Health.** The website's `/health` answers 200 only when the API and, through the API's `/health/ready`, Postgres answer; otherwise 503 with the failing part.

What CI proves before an image is published: `scripts/checks/production-stack.test.mjs` (the composition's policy, rendered from the example settings) and `scripts/checks/production-stack.e2e.mjs` (`pnpm test:production-stack`: the images built, checked for forbidden files and started as this composition with the demo seed, all healthy, only the website published, on loopback). The release workflow runs that smoke check on the very images it then publishes, with the complete-stack browser tests, before it pushes anything (`docs/release-workflow.md`, Images).

## Deployment

`scripts/deploy.sh` deploys a verified tag set or rolls back to the previous verified release (`docs/release-workflow.md`, Deployment). It runs from the server's checkout of this repository, as the `deploy` user, and accepts exactly one of:

```text
deploy release=<commit SHA> api=<commit SHA> web=<commit SHA> mcp-admin=<commit SHA>
rollback
```

`release` is the release commit (the commit the release workflow ran for); the three services name their image tags. Anything else (an unknown service, a short or upper-case SHA, a release commit or service named twice or missing, any shell syntax, path or option) is refused before anything runs.

- **The forced command.** The release workflow's key is restricted to the script in the `deploy` user's `~/.ssh/authorized_keys`, so the key cannot open a shell, forward ports or run anything else. The script reads its input from `SSH_ORIGINAL_COMMAND` and ignores arguments. One line, with the server's paths in place of the placeholders:

  ```text
  command="DEPLOY_ENV_FILE=<production environment file> DEPLOY_STATE_DIR=<state folder> <checkout>/infra/scripts/deploy.sh",restrict ssh-ed25519 <public key> deploy@github-actions
  ```

  The script also reads `DEPLOY_BACKUP`, `DEPLOY_REGISTRY`, `DEPLOY_WAIT_TIMEOUT` and `COMPOSE_FILE` from its environment, so an SSH client must not be able to set them: the server's `sshd` keeps `PermitUserEnvironment no` (the default) and accepts no `AcceptEnv` pattern that matches `DEPLOY_*` or `COMPOSE_*`, and the key line has no `environment=` option.

- **The `deploy` user** may run `docker` (member of the `docker` group), owns the production environment file (mode 600), the state folder and the checkout (a deployment fetches and checks out in it). Its forced-command key is used only by the workflow; the owner signs in with their own key.
- **State.** `DEPLOY_STATE_DIR` holds `releases`, the record of verified releases (one tag set per line, newest last), and the `lock` that keeps two deployments from running at once.
- **Settings** besides the two above, all optional: `DEPLOY_BACKUP` (the backup script, default `infra/scripts/backup.sh` of the checkout, which reads the same `DEPLOY_ENV_FILE`; without an executable script a release that adds a migration is refused), `DEPLOY_REGISTRY` (default the registry of `production/compose.yaml`), `DEPLOY_WAIT_TIMEOUT` (seconds, default 300) and `COMPOSE_FILE`.
- **The checkout.** A deployment runs with the repository files of the release it deploys. Before anything else it runs `git fetch origin` in the checkout (its only network access besides the image pulls), refuses a release commit that is not on `origin/master` and a checkout with local modifications to tracked files (nothing changed either way), checks the release commit out detached and runs that commit's `infra/scripts/deploy.sh` again, exactly once, with `DEPLOY_RELEASE_CHECKED_OUT` set to the commit; the second run only checks that the checkout is at that commit (it refuses otherwise) and deploys with the release's script, Compose files and backup script. A change to `infra/` or `compose.yaml` therefore reaches the server with the next deployment, which every push to `master` runs; nobody updates the checkout by hand, and no file in it is edited on the server (settings belong in the environment file). The input can only name a commit already on `origin/master`, so the key cannot bring code of its own.
- **Rollback and the checkout.** A rollback leaves the checkout as it is, at the commit of the release being rolled back from: the record of verified releases holds image tags only, and the newer Compose files and script stay compatible with the previous release's images by the same rule that keeps a migration compatible with it (`docs/release-workflow.md`, Migration compatibility rule). A rollback across a change that breaks that rule is the owner's manual step: check out the older commit as `deploy`, then roll back.
- **Images** are public GHCR packages (Server preparation), so the server pulls without a registry login.
- **Rollback**, by the owner: signed in to the server with their own key, as the `deploy` user, `DEPLOY_ENV_FILE=<production environment file> DEPLOY_STATE_DIR=<state folder> <checkout>/infra/scripts/deploy.sh rollback` (the same settings as the forced-command line). It starts the previous verified release without running the migration, waits for health and drops the newest release from the record. A second rollback goes one more release back; images already removed from the server are pulled again from GHCR.
- **GitHub Environment `production`.** Deployment branches limited to `master`; secrets `DEPLOY_SSH_KEY` (the private key of the forced-command line), `DEPLOY_HOST` (the server's host name) and `DEPLOY_KNOWN_HOSTS` (the server's `known_hosts` line, from `ssh-keyscan` checked against the server's own fingerprint). No application secret is stored there.
- **Production smoke check.** After each deployment the workflow runs `scripts/release/production-smoke.mjs` against `https://sebela.dev`. The owner can run it at any time, with a real API key if wanted: `SMOKE_BASE_URL=https://sebela.dev [SMOKE_API_KEY=<key>] node scripts/release/production-smoke.mjs`.

## Backups

`scripts/backup.sh` backs up the production database off the server (`docs/release-workflow.md`, Backups). It takes no arguments and reads the production environment file named by `BACKUP_ENV_FILE`, otherwise `DEPLOY_ENV_FILE` (so `deploy.sh` calls it unchanged before a release that adds a migration).

- **What.** `pg_dump` of `DATABASE_NAME` in the custom format, run in the `postgres` container as `POSTGRES_USER`, without owners, privileges or extensions (restore creates pgvector itself). Uploaded media are not in it: they live in their own Bunny Storage zone, off the server already.
- **Encrypted on the way.** The dump is piped straight into `age --encrypt` to `BACKUP_AGE_RECIPIENT`, the owner's public key. No unencrypted dump touches the disk, and the private key is never needed on the server: it stays offline with the owner.
- **Stored** in the Bunny Storage zone `BACKUP_STORAGE_ZONE` (`sebela-backups`) as `postgres/<UTC time>.dump.age`, through the zone's HTTP storage API (`BACKUP_STORAGE_ENDPOINT`, `BACKUP_STORAGE_PASSWORD`).
- **Retention.** Every backup younger than 14 days stays; of the older ones up to three months (92 days) the newest of each ISO week stays; the rest are removed. Files outside `postgres/` are never touched.
- **Heartbeat.** Only after the upload and the retention succeeded is the Better Stack heartbeat `BACKUP_HEARTBEAT_URL` requested, so a failed or missing backup alerts by its missing ping. Any earlier failure exits non-zero without the ping; a refused ping is reported, and the backup still counts.
- **Nightly** from `crons.txt` at 02:30 UTC, entered once in the hosting panel's cron jobs for the `deploy` user; the output goes to the system log under the tag `sebela-backup`.
- **No secret is printed**: curl reads the addresses and the zone's password from its standard input, and a failed request reports only its HTTP status. Every setting is checked before anything runs.

## Restore

`scripts/restore.sh` never decrypts. The owner fetches a backup, decrypts it on their own machine with the offline key and brings the decrypted dump back to the server only for the restore: copied to a file only `deploy` can read and deleted right after (Owner's commands over SSH). Every command runs in the owner's `sudo -iu deploy` session with `BACKUP_ENV_FILE=<production environment file>`; below, `restore` stands for `<checkout>/infra/scripts/restore.sh` run there, and `fetch` writes the encrypted backup to standard output so it can be copied to the owner's machine.

```sh
restore list                                         # the backups, oldest first
restore fetch <backup> > <backup>                    # one encrypted backup, to the owner's machine
# on the owner's machine: age --decrypt --identity <owner key> <backup> > <dump>, copy <dump> to the server
restore into <database> --confirm <database> < <dump>  # restore and compare row counts; then delete <dump>
restore drop <database> --confirm <database>         # remove a rehearsal database
```

- **`into`** creates `<database>` for `DATABASE_USER` (an existing one only with `--replace`, which drops it first), creates the `vector` extension, restores the dump in one transaction as that role and prints the row count of every table beside the source's: `--compare <database>`, otherwise `DATABASE_NAME`. Any difference exits non-zero. If a restore with `--replace` fails after the drop, the error says the database is now empty or missing; restore a backup into it again. It refuses `POSTGRES_DB`.
- **Rehearsal** (before the launch and after a change to the scripts): restore the latest backup into a temporary database such as `sebela_restore`, check that the counts are equal, then `drop` it. A restore is rehearsed this way before the launch.
- **Restoring production** means restoring into `DATABASE_NAME` itself with `--replace` after the API, the website and MCP Admin are stopped (`docker compose ... stop api web mcp-admin`), naming a rehearsal database restored from the same backup with `--compare`; then start the release that matches the backup's schema again.
- **`drop`** removes only a rehearsal database: it refuses `DATABASE_NAME` and `POSTGRES_DB`.
- Both `into` and `drop` need the database's name twice, the second time after `--confirm`.

## Clearing the demo content

The production database starts with the fictional demo seed. Before the real content is entered, the owner clears it, as `deploy`:

```sh
BACKUP_ENV_FILE=<production environment file> <checkout>/infra/scripts/clear-demo.sh --confirm <DATABASE_NAME>
```

It refuses a confirmation other than `DATABASE_NAME`, runs `backup.sh` first and stops when the backup fails. Then the API image's `clear-content` command empties every table of the profile and the AI roadmap and deletes their stored media files. The migrations, API keys and the audit stay, so the database is empty, migrated and ready for the content; the backup just taken holds the demo content. The website's content cache can still show the demo content for up to `WEB_CONTENT_REVALIDATE_SECONDS` (60 seconds by default), since the clear sends no invalidation notification.

## Server preparation

The owner's one-time steps (issue #236), in order. Each names the setting it fills; the details follow below.

1. **The `deploy` user.** Create it, add it to the `docker` group, give it the production environment file and the state folder (below), and the checkout (step 2). In its `~/.ssh/authorized_keys` put only the forced-command line of Deployment, for a new ed25519 key pair made for the workflow; the private key goes into the GitHub Environment and nowhere else. Check that `sshd` keeps `PermitUserEnvironment no` and accepts no `AcceptEnv` pattern that matches `DEPLOY_*`, `BACKUP_*` or `COMPOSE_*`. The owner signs in with their own key and runs the owner's commands (rollback, restore, clear) as `deploy` with `sudo --user=deploy`.
2. **The checkout and the state folder.** Clone the repository's `master` on the server as `deploy` over HTTPS (the repository is public, so `git fetch` needs no credential), so `deploy` owns the checkout; create `DEPLOY_STATE_DIR`, owned by `deploy`, mode 700. The first deployment moves the checkout to its release commit.
3. **The production environment file**, from `production/.env.example` (below), including the `BACKUP_*` values of steps 6 to 8.
4. **The hosting panel's site and nginx** for `sebela.dev` (below).
5. **Postgres and pgvector.** Start Postgres alone, then as the superuser `CREATE EXTENSION vector` in `DATABASE_NAME` and create the application role (below); then start the stack (First start).
6. **The `sebela-backups` zone.** In Bunny, a Storage Zone `sebela-backups`, separate from the media zone, without a pull zone, so nothing in it is ever served. Its storage endpoint (the https address of its region) goes into `BACKUP_STORAGE_ENDPOINT`, its password into `BACKUP_STORAGE_PASSWORD`.
7. **The `age` key pair**, made by the owner on their own machine with `age-keygen --output <owner key>`. The public key (`age1...`, also printed by `age-keygen -y <owner key>`) goes into `BACKUP_AGE_RECIPIENT`; the private key stays offline with the owner, with a second copy kept offline elsewhere, and is never put on the server. Without it no backup can be restored. The server needs `age` installed (`apt install age`) to encrypt.
8. **Better Stack.** An uptime monitor for `https://sebela.dev` and one for `https://sebela.dev/health`, and a heartbeat with a period of one day and a grace period of a few hours; the heartbeat's address goes into `BACKUP_HEARTBEAT_URL`. Alerts go by e-mail and to the mobile app.
9. **The nightly backup.** The line of `crons.txt`, with the server's paths in place of the placeholders, as a cron job in the hosting panel for `deploy`. Run `backup.sh` once by hand and check that the backup appears in the zone and the heartbeat turns green; then rehearse a restore (Restore).
10. **Umami** (Analytics, below).
11. **GHCR packages** made public after the first release (below).
12. **The GitHub Environment `production`** with its three secrets (Deployment).

Facts this composition relies on:

- **First start, in order.** (1) The production environment file is in place. (2) `docker compose ... up --detach --wait postgres` initialises the volume. (3) The superuser creates the `vector` extension and the application role (below). (4) `docker compose ... up --detach --wait` runs the migration, which must finish successfully before the API starts, then the API, the website and MCP Admin.
- **Production environment file.** Created from `production/.env.example`, mode 600, owner `deploy`; every `replace-with-...` value replaced. It never enters Git, an image or a log.
- **Database role and pgvector.** `POSTGRES_USER` is the cluster's superuser and only initialises the volume. Once, after the first start of Postgres, the superuser creates the `vector` extension in `DATABASE_NAME` and the application role `DATABASE_USER` that owns that database; the migration and the API connect only as that role.
- **nginx.** The hosting panel's site for `sebela.dev` with its Let's Encrypt certificate takes `nginx/sebela.dev.conf`, with the website's `WEB_PORT` and the certificate paths in place of its placeholders, and includes the CDN edge address file of `scripts/bunny-edge-addresses.sh` (Open points).
- **GHCR packages.** The release workflow creates `sebela-api`, `sebela-web` and `sebela-mcp-admin` on its first publish, linked to the repository by their source label. Once, the owner sets each package's visibility to public in its package settings, so the server pulls without a registry login.
- **Analytics.** On the Umami Cloud account, the website is created for `sebela.dev`; its tracker script address (`https://cloud.umami.is/script.js`) goes into `WEB_ANALYTICS_SCRIPT_URL` and its website ID into `WEB_ANALYTICS_WEBSITE_ID`, both public values. They stay empty until the owner turns analytics on.

## Open points for the server preparation

### The visitor's address behind Bunny CDN

Decided: Bunny sends the visitor's address in `X-Real-IP`, and the site's server block trusts it only from Bunny's edge addresses (`real_ip_header X-Real-IP` and the included `set_real_ip_from` list, `nginx/sebela.dev.conf`), so the request budget counts per visitor. `scripts/bunny-edge-addresses.sh` writes that list from Bunny's published IPv4 and IPv6 edge lists to `/etc/nginx/bunny-edge-addresses.conf`, keeps only bare addresses, refuses a short or failed answer and restores the previous file when `nginx -t` rejects the new one; it reloads nginx only after the test passes. The owner installs it once as root and runs it daily from root's crontab:

```sh
install -m 755 <checkout>/infra/scripts/bunny-edge-addresses.sh /usr/local/sbin/bunny-edge-addresses
15 4 * * * /usr/local/sbin/bunny-edge-addresses 2>&1 | logger --tag bunny-edge
```

### Owner's commands over SSH

Decided: no passwordless sudo rule. Agents run as the same account the owner signs in with, so a rule that let it run `restore.sh` as `deploy` without a password would let agents do so too. The owner runs the owner's commands (rollback, restore, clear) interactively with `sudo -iu deploy` and their own password. For a restore, the owner copies the encrypted backup to their machine with `restore fetch`, decrypts it there, copies the decrypted dump to a file only `deploy` can read on the server, restores it with `restore into … < <dump>` in that session and deletes the file at once.

### MCP Admin over the SSH tunnel

Decided: MCP Admin is published on the host's loopback interface only (`MCP_ADMIN_HOST`, `MCP_ADMIN_PORT`, Addresses above) and reached through an SSH tunnel to that port; nginx never proxies to it.
