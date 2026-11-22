"""Write the service's OpenAPI document to `openapi.json` (`pnpm export:openapi`)."""

from __future__ import annotations

import json
from pathlib import Path

from ai_service.app import openapi_document

TARGET = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    TARGET.write_text(json.dumps(openapi_document(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
