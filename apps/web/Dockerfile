# The website image, built from the repository root (context `.`, allowlist in `.dockerignore`):
#
#   docker build --file apps/web/Dockerfile .
#
# The build needs no API, no setting and no secret: pages render on each request, and the image
# contains code only, no environment file, credentials or content. Every setting comes from the
# environment at run time (apps/web/AGENTS.md, "Configuration" and "Container").

# Node.js 26 (`.nvmrc`) on Debian trixie, pinned by tag and by the digest of its multi-architecture
# index, as apps/api/Dockerfile. Upgrade both images together.
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
# BEGIN debian-package-fixes (identical in every Dockerfile; scripts/checks/image-debian-packages.test.mjs)
# Debian packages upgraded past the base image to at least the version that fixes a finding, from
# the suites the base already lists: zlib1g from trixie-security (its floor version is also in
# trixie main), libc6 and libc-bin from trixie (a point release). The floors are minimums, not pins:
# apt installs the newest version those suites offer, so a Debian point release cannot break the
# build, and the build fails if the newest version the suites offer for a package is below its
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
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build stage: the locked installation with development tools, then the website and the workspace
# packages it depends on, as Next's self-contained server (`output: "standalone"`, switched on by
# WEB_BUILD_STANDALONE in next.config.ts). Lifecycle scripts are skipped: the root `prepare`
# installs Git hooks.
FROM base AS build
# pnpm exactly as `packageManager` in package.json, installed with `npm ci` from infra/pnpm, whose
# lockfile pins it and its native executables by integrity hash (infra/README.md, pnpm in the images).
COPY infra/pnpm/package.json infra/pnpm/package-lock.json /opt/pnpm/
RUN npm ci --prefix /opt/pnpm --omit=dev --no-audit --no-fund && npm cache clean --force \
  && ln -s /opt/pnpm/node_modules/.bin/pnpm /usr/local/bin/pnpm
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
