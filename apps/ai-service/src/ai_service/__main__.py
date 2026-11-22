"""Runs the service with uvicorn on the host and port the environment names."""

from __future__ import annotations

import os
import sys

import uvicorn

from ai_service.app import create_app
from ai_service.config import ConfigError, Settings


def main() -> None:
    try:
        settings = Settings.from_env(os.environ)
    except ConfigError as error:
        sys.exit(f"ai-service: {error}")
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        proxy_headers=False,
        server_header=False,
        timeout_graceful_shutdown=int(settings.shutdown_grace_s) + 10,
    )


if __name__ == "__main__":
    main()
