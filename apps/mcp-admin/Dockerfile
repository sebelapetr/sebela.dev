# The MCP Admin image, built from the repository root (context `.`, allowlist in `.dockerignore`):
#
#   docker build --file apps/mcp-admin/Dockerfile .
#
# It contains MCP Admin and the workspace packages it is built from (the API client and the shared
# contracts) only: no database or storage package, no environment file, no API key and no content.
# Every setting comes from the environment at run time (apps/mcp-admin/AGENTS.md, "Configuration");
# each caller presents its own API key.

# Node.js 26 (`.nvmrc`) on Debian trixie, pinned by tag and by the digest of its multi-architecture
# index, the same base as the API image. Upgrade both together.
FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
# pnpm exactly as `packageManager` in package.json.
RUN npm install --global pnpm@12.21.0 && npm cache clean --force
WORKDIR /app

# Build stage: the locked installation with development tools, then MCP Admin and the workspace
# packages it depends on. Lifecycle scripts are skipped: the root `prepare` installs Git hooks.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@sebela/mcp-admin..." \
  && pnpm --filter "@sebela/mcp-admin..." build

# Runtime stage: production dependencies only and the built output, in the workspace layout the
# packages resolve them in.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/mcp-admin/package.json apps/mcp-admin/
COPY --from=build /app/packages/api-client/package.json packages/api-client/
COPY --from=build /app/packages/config/package.json packages/config/
COPY --from=build /app/packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter "@sebela/mcp-admin..." \
  && pnpm store prune
COPY --from=build /app/packages/api-client/dist packages/api-client/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/mcp-admin/dist apps/mcp-admin/dist

USER node
WORKDIR /app/apps/mcp-admin
CMD ["node", "dist/server.js"]
