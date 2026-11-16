# Phase 8 — Continuous delivery and launch

|            |                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Status     | Draft, awaiting approval                                                                                       |
| Date       | 2026-11-15                                                                                                     |
| Parent     | `.plan/00-overview/prd.md`                                                                                     |
| Depends on | All previous phases                                                                                            |
| Result     | Tagging a release deploys it to the owner's server; the real data is loaded; sebelapetr.cz serves the new site |

## Problem Statement

Everything is built and nothing is live. The site runs on developers' machines with fictional data; the current sebelapetr.cz still presents Petr as he was in 2024. Putting the new system on a server by hand would work once, but every later fix would be a manual, error-prone operation — and how software is released is part of what this repository is meant to demonstrate.

## Solution

- A release pipeline: a version tag builds the images, verifies them as a whole, and deploys them to the server.
- A production Compose stack behind a reverse proxy with TLS.
- Backups that are proven to restore.
- The launch itself: the owner's real data loaded, the old roadmap data imported one last time, the domain switched, the old addresses redirected.

There is no staging environment. Its job — catching a broken release before visitors do — is done by a full-stack check in the pipeline and by a rollback.

## User Stories

1. As the owner, I want to release by pushing a version tag, so that deploying is one deliberate act.
2. As the owner, I want a release verified as a whole running system before it reaches the server, so that the absence of staging does not mean testing in production.
3. As the owner, I want a failed deployment to roll back to the previous version by itself, so that a bad release does not leave the site down.
4. As the owner, I want to roll back to any earlier version with one command.
5. As the owner, I want database migrations to run once, before the new version starts, so that the app never runs against a half-migrated schema.
6. As the owner, I want a backup taken before every deployment and every night, stored away from the server.
7. As the owner, I want a restore to have been rehearsed, so that I know the backups work.
8. As the owner, I want secrets to live on the server and in the repository's secret store, never in git.
9. As the owner, I want a changelog and a GitHub release produced from the commit history, so that every version says what changed.
10. As the owner, I want to know when the site is down or a service is unhealthy without checking by hand.
11. As the owner, I want my real profile, my CV file and my roadmap history loaded at launch, so that the site opens with real content.
12. As the owner, I want the old site's addresses to lead somewhere sensible on the new one, so that existing links and search results keep working.
13. As the owner, I want a launch checklist, so that nothing is forgotten on the day.
14. As a visitor, I want the site served over HTTPS and fast.
15. As a visitor, I want a release to cause at most a few seconds of interruption.
16. As a technical evaluator, I want the release process documented in the repository, so that I can see how the project ships.
17. As a development agent, I want the production stack defined as code in the repository, so that changing it is a reviewed change like any other.

## Implementation Decisions

### Releases

- `master` always holds releasable code: it receives only reviewed phase pull requests with green CI.
- A release is a version tag `vX.Y.Z` on `master`, following semantic versioning.
- The tag triggers the pipeline: build → verify → publish images → back up → deploy → migrate → health check → on failure, roll back.
- A changelog is generated from Conventional Commits and published as a GitHub release.
- Content changes are not releases; they go through the API.

### Verification without staging

- Before anything is published, the pipeline starts the **complete stack** from the freshly built images — database, API, website, `mcp-admin`, `mcp-public`, `ai-service` — loads the demo seed, and runs the end-to-end tests against it, with models replaced by fakes.
- Only images that passed are published and deployed, and they are the same images, not rebuilt ones.

### Images

- One image per app, built from its Dockerfile, tagged with the version and stored in the GitHub container registry.
- The server pulls images; it does not build.

### Production stack

- One Compose stack on the owner's VPS, defined in the repository as production overrides of the base Compose file: reverse proxy, website, API, `mcp-admin`, `mcp-public`, `ai-service`, Postgres with pgvector, and a one-off migration service.
- **Reverse proxy** with automatic TLS certificates, security headers, compression and rate limits at the edge.
- **Addresses:** the website on the main domain; the API, the public MCP server and `mcp-admin` each on their own subdomain. Only the reverse proxy is exposed; Postgres and the generation endpoint of `ai-service` are reachable only inside the stack.
- **Migrations** run as the one-off service and must finish before the new API starts.
- **Deployment** recreates the services with the new images; an interruption of a few seconds is accepted. Zero-downtime deployment is not a goal of this phase.
- **Health checks** on every service decide whether a deployment succeeded.
- **Rollback:** the previous version's images are redeployed automatically when health checks fail, and by one command at any time. Migrations are forward-only, so a release that changes the schema must keep the previous version working — the rule is written into `docs/release-workflow.md`.

### Configuration and secrets

- Production configuration is an environment file on the server, outside git. The repository documents every variable in the example file.
- The pipeline's credentials (server access, registry) are repository secrets.
- Production holds: the database password, the production storage zone key, the model provider keys, the embeddings key, the monitoring keys. API keys for agents are created on the server with the command from phase 2.
- The production storage zone and its key exist only here; development keys cannot reach it.

### Backups

- A database dump before every deployment and every night, encrypted and uploaded to object storage in a zone separate from the site's files.
- Retention: daily for two weeks, weekly for three months.
- Files in object storage are the provider's responsibility; the database references them by key.
- **A restore is rehearsed** before launch and documented step by step. A backup that has never been restored is not counted as a backup.
- The retrieval index is not backed up; it is rebuilt.

### Monitoring

- An external uptime check on the website, the API health route and the public MCP endpoint, alerting the owner.
- Container logs kept on the server with rotation.
- Analytics: Umami Cloud, set up here; the limits of its free plan are checked at this point.
- LLM monitoring (Langfuse) was decided in phase 7 and is deployed or connected here.
- The model budget: the hard limit at the provider is set here, and the backend's daily budget is configured.

### Launch

Done once, by the owner with an agent, following a checklist kept in the repository:

1. Provision the server and the DNS records for the subdomains.
2. Deploy the first release with an empty database.
3. Load the owner's private profile seed; upload the photo, logos and the CV file.
4. Take a fresh dump of the old Road to AI database, run the mapper, load the result. This is the final import; from now on the old application is read-only.
5. Rebuild the retrieval index.
6. Create the API key for `mcp-admin` and connect the owner's agent.
7. Check every page with real data at the three widths and in both themes; run the chat by hand with real models, including a few adversarial questions.
8. Set the model budget and confirm the limits.
9. Switch the domain.
10. Verify redirects, the sitemap, `llms.txt`, structured data and analytics.

- **Redirects:** the addresses of the current sebelapetr.cz are mapped to the new ones. What to do with roadtoai.dev is the owner's decision and outside this phase; if he redirects it, the address table of phase 4 is the mapping.
- **The README** gets its final form: what the project is, architecture, how the assistant, MCP and retrieval work, how development is orchestrated, the measurements from phases 5–7, how it is released.

### Documentation

`docs/release-workflow.md` is completed: versioning, the pipeline, the migration rule, rollback, backups and restore, the launch checklist.

## Testing Decisions

- **The pipeline is tested by using it:** a first release to the server with demo data before any real data is loaded.
- **Rollback is tested deliberately:** a release with a failing health check must end with the previous version running.
- **The restore rehearsal** is a required step, with the restored database checked against the original.
- **The full-stack check** in the pipeline reuses the end-to-end tests of phases 3, 4 and 7; no new test framework.
- **After launch:** a scripted smoke check against production — pages respond, the API is healthy, a write without an API key is refused, the MCP endpoints answer.

## Out of Scope

- A staging environment.
- Zero-downtime or blue-green deployment.
- Several servers, orchestration platforms, autoscaling.
- Infrastructure provisioning as code; the server is set up once, by documented steps.
- The future of roadtoai.dev.
- OAuth for `mcp-admin`.

## Further Notes

- **Open, for the owner before this phase starts:** whether the stack runs on the existing Hetzner server or a new one; the production domain (the repository is named `sebela.dev`, the plan says sebelapetr.cz); the reverse proxy product (Traefik is the prior art from Booky); the monthly model budget.
- **HITL:** the whole launch is done with the owner. The pipeline and the production stack are built by the loop; the ten launch steps are not.
- Because there is no staging, the rule "a release must keep the previous version working against the new schema" is what makes rollback safe. The reviewer checks it on every migration.
- **Prior art:** the release workflow, Traefik set-up and per-service image tags of the owner's Booky monorepo.
