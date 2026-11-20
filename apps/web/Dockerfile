# The website image, built from the repository root (context `.`, allowlist in `.dockerignore`):
#
#   docker build --file apps/web/Dockerfile .
#
# The build needs no API, no setting and no secret: pages render on each request, and the image
# contains code only, no environment file, credentials or content. Every setting comes from the
# environment at run time (apps/web/AGENTS.md, "Configuration" and "Container").

# Node.js 26 (`.nvmrc`) on Debian trixie, pinned by tag and by the digest of its multi-architecture
# index, as apps/api/Dockerfile. Upgrade both images together.
FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build stage: the locked installation with development tools, then the website and the workspace
# packages it depends on, as Next's self-contained server (`output: "standalone"`, switched on by
# WEB_BUILD_STANDALONE in next.config.ts). Lifecycle scripts are skipped: the root `prepare`
# installs Git hooks.
FROM base AS build
# pnpm exactly as `packageManager` in package.json.
RUN npm install --global pnpm@12.21.0 && npm cache clean --force
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@sebela/web..." \
  && WEB_BUILD_STANDALONE=1 pnpm --filter "@sebela/web..." build

# Runtime stage: the traced server with the production files it needs and the static assets, no
# package manager and no development dependency. `@sebela/ui` was compiled into the build.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
USER node
WORKDIR /app/apps/web
# Healthy once the server answers a route that reads no content, so a website whose API is down
# still runs; the same check as compose.yaml, which overrides it.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s --start-interval=1s \
  CMD ["node", "--eval", "fetch(\"http://127.0.0.1:\" + process.env.WEB_PORT + \"/robots.txt\").then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
# The server listens on WEB_HOST and WEB_PORT, as `scripts/next.mjs` does on the host, and refuses
# to start without them; Next's own server reads them as HOSTNAME and PORT.
CMD ["sh", "-c", ": \"${WEB_HOST:?set WEB_HOST}\" \"${WEB_PORT:?set WEB_PORT}\"; HOSTNAME=\"$WEB_HOST\" PORT=\"$WEB_PORT\" exec node server.js"]
