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
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
# BEGIN debian-package-fixes (identical in every Dockerfile; scripts/checks/image-debian-packages.test.mjs)
# Debian packages upgraded past the base image to at least the version that fixes a finding, from
# the suites the base already lists: zlib1g from trixie-security, libc6 and libc-bin from trixie
# (a point release). The floors are minimums, not pins: apt installs the newest version those suites
# offer, so a Debian point release cannot break the build, and the build fails if none reaches a
# floor. Dependabot does not see these floors. Remove a package from the list, and its entry in
# scripts/release/image-scan-exceptions.json, when the base image already has its floor (the build
# fails here as soon as it does, so the step cannot rot); remove the whole block when none is left
# (docs/release-workflow.md, "Image scan"). Only the listed packages change; the apt lists are
# removed in the same layer.
RUN set -eu; export DEBIAN_FRONTEND=noninteractive; \
  floors="zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 libc6=2.41-12+deb13u5 libc-bin=2.41-12+deb13u5"; \
  covered=""; needed=""; \
  for floor in $floors; do \
    package="${floor%%=*}"; \
    installed="$(dpkg-query --show --showformat='${Version}' "$package")"; \
    if dpkg --compare-versions "$installed" ge "${floor#*=}"; then \
      covered="$covered $package"; \
    else \
      needed="$needed $package"; \
    fi; \
  done; \
  if [ -n "$covered" ]; then \
    echo "The base image already has a fixed version of:$covered. Remove those packages from the floors and their entries in scripts/release/image-scan-exceptions.json; remove the whole debian-package-fixes block once no package is left." >&2; \
    exit 1; \
  fi; \
  apt-get update; \
  for floor in $floors; do \
    package="${floor%%=*}"; \
    candidate="$(apt-cache policy "$package" | sed -n 's/^  Candidate: //p')"; \
    if ! dpkg --compare-versions "$candidate" ge "${floor#*=}"; then \
      echo "No suite the base lists offers $package ${floor#*=} or newer (candidate: $candidate): move the floor or remove the debian-package-fixes block." >&2; \
      exit 1; \
    fi; \
  done; \
  apt-get install --yes --no-install-recommends --only-upgrade $needed; \
  rm -rf /var/lib/apt/lists/*
# END debian-package-fixes
# pnpm exactly as `packageManager` in package.json, installed with `npm ci` from infra/pnpm, whose
# lockfile pins it and its native executables by integrity hash (infra/README.md, pnpm in the images).
COPY infra/pnpm/package.json infra/pnpm/package-lock.json /opt/pnpm/
RUN npm ci --prefix /opt/pnpm --omit=dev --no-audit --no-fund && npm cache clean --force \
  && ln -s /opt/pnpm/node_modules/.bin/pnpm /usr/local/bin/pnpm
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
# Healthy once the server answers its health route, which needs no key and calls no API; the same
# check as compose.yaml, which overrides it.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s --start-interval=1s \
  CMD ["node", "--eval", "fetch(\"http://127.0.0.1:\" + process.env.MCP_ADMIN_PORT + \"/health\").then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]
