# The AI service image: the FastAPI app and the Python workspace members it is built from, run
# unprivileged. Built from the repository root: `docker build --file apps/ai-service/Dockerfile .`
# The build context is the allowlist in .dockerignore; no environment file and no key enters it.
# Every setting, the provider key included, comes from the container's environment at run time
# (apps/ai-service/AGENTS.md, Settings).

# Python exactly as .python-version, pinned by tag and by the digest of its multi-platform index.
FROM python:3.13.18-slim-trixie@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90 AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# uv at the lower bound of `required-version` in the root pyproject.toml, pinned by digest.
FROM ghcr.io/astral-sh/uv:0.7.22@sha256:629240833dd25d03949509fc01ceff56ae74f5e5f0fd264da634dd2f70e9cc70 AS uv

# Build stage: the locked runtime dependencies of ai-service, with the workspace members installed
# as packages (not editable), so the runtime stage needs only the virtual environment.
FROM base AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_NO_CACHE=1
COPY pyproject.toml uv.lock .python-version ./
COPY packages/api-client-python packages/api-client-python
COPY packages/llm-agent packages/llm-agent
COPY apps/ai-service apps/ai-service
RUN uv sync --locked --no-dev --no-editable --package ai-service

# Runtime stage: the virtual environment only, owned by root and run by an unprivileged user.
FROM base AS runtime
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
COPY --from=build /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
USER app
# The port is the container's LLM_AGENT_PORT; nothing here fixes it.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s --start-interval=1s \
  CMD ["python", "-c", "import os, sys, urllib.request; sys.exit(0 if urllib.request.urlopen(\"http://127.0.0.1:\" + os.environ[\"LLM_AGENT_PORT\"] + \"/health\", timeout=4).status == 200 else 1)"]
CMD ["python", "-m", "ai_service"]
