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
- **Reverse proxy and TLS.** The server's Ploi-managed nginx terminates TLS with Let's Encrypt and proxies to the website; its reference configuration (redirects, request limits, security headers, compression) is `infra/nginx/sebela.dev.conf`.
- **Website switches.** `WEB_INDEXING=on` allows indexing; by default every page sends `noindex`. Umami Cloud's script loads only when `WEB_ANALYTICS_WEBSITE_ID` is set.
- **Health.** The website's `/health` answers 200 only when the API and Postgres (through the API's `/health/ready`) answer, otherwise 503 with the failing part.
- **Verified in CI** by the production composition policy (`scripts/checks/production-stack.test.mjs`) and the production stack smoke check (`pnpm test:production-stack`, `docs/testing.md`, CI).

## To be defined in phase 10

- Versioning and tagging
- Pipelines that build images and deploy them
- How MCP Admin is reached through the SSH tunnel (`infra/README.md`, Open question)
- Database backups and restore procedure
- Rollback
- The domain switch

## First-release scope

Phase 10 deploys the website, the API and authenticated internal/SSH-tunnel administration; phases 7, 8 and 9/9.1 add live structured-data chat, public MCP and approved-source RAG through their delivery issues, and the launch with real data closes phase 9.1. Graph, ontology and external interactive MCP UI are post-launch phases 11–13, not launch gates.

The public reverse proxy must not expose private content-write API routes as an alternative to Admin MCP. Backups include privately stored knowledge originals and source/approval metadata; rehearse restoration and retrieval rebuild as well as database restore. Private originals never receive a public CDN/static-file mapping. Later releases preserve these boundaries and the forward-compatible migration/rollback rule.
