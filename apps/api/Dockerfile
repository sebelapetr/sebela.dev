# The API image, built from the repository root (context `.`, allowlist in `.dockerignore`):
#
#   docker build --file apps/api/Dockerfile .
#
# One image runs the server (default command), the migration service of compose.yaml
# (`node /app/packages/db/dist/cli/migrate.js`) and the maintenance commands `dist/cli/seed.js` and
# `dist/cli/api-keys.js`. It contains code and the fictional demo seed only: no environment file,
# no credentials and no personal content. Every setting comes from the environment at run time
# (apps/api/AGENTS.md, "Container stack"). The server never migrates on start.

# Node.js 26 (`.nvmrc`) on Debian trixie, pinned by tag and by the digest of its multi-architecture
# index, so a re-pushed tag cannot change what is built. Upgrade both together.
FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
# pnpm exactly as `packageManager` in package.json.
RUN npm install --global pnpm@12.21.0 && npm cache clean --force
WORKDIR /app

# Build stage: the locked installation with development tools, then the API and the workspace
# packages it depends on. Lifecycle scripts are skipped: the root `prepare` installs Git hooks.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@sebela/api..." \
  && pnpm --filter "@sebela/api..." build

# Runtime stage: production dependencies only, the built output, the committed migrations and the
# demo seed, in the workspace layout the packages resolve them in.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/api-client/package.json packages/api-client/
COPY --from=build /app/packages/config/package.json packages/config/
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/memory/package.json packages/memory/
COPY --from=build /app/packages/services/package.json packages/services/
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter "@sebela/api..." \
  && pnpm store prune
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/packages/db/seed packages/db/seed
COPY --from=build /app/packages/memory/dist packages/memory/dist
COPY --from=build /app/packages/services/dist packages/services/dist
COPY --from=build /app/apps/api/dist apps/api/dist

# Local media storage: the folder compose.yaml mounts its media volume on. Created here and owned by
# the unprivileged user, so a new named volume inherits the ownership and the API can write to it.
RUN mkdir -p /var/lib/sebela/media && chown node:node /var/lib/sebela/media
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
