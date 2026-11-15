# Release workflow

Skeleton. The content is defined in phase 8 (`.plan/08-delivery/prd.md`).

## Decided so far

- The site launches publicly once all phases are done and replaces the current sebelapetr.cz. Phases are not public releases.
- Deployment target is the owner's VPS, with Docker: one image per app and one Compose stack, the same composition as locally.
- Migrations run as a dedicated step before the API starts, never from the API on startup. There are no down migrations: fix forward, back up before deploying.
- Content changes do not need a release; they go through the API.
- A release is a version tag `vX.Y.Z` on `master`. Production only; there is no staging environment.
- Before deployment the pipeline starts the complete stack from the built images with the demo seed and runs the end-to-end tests. Only images that passed are deployed.
- A failed deployment rolls back to the previous version. Because migrations are forward-only, **a release that changes the schema must keep the previous version working** against the new schema.
- Backups: before every deployment and nightly, stored away from the server; a restore is rehearsed before launch.

## To be defined in phase 8

- Versioning and tagging
- Pipelines that build images and deploy them
- Production Compose overrides, reverse proxy and TLS
- Database backups and restore procedure
- Rollback
- The domain switch
