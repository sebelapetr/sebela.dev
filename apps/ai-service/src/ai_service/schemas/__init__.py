"""The service's wire contracts (stub)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class GenerationRequest(BaseModel):
    history: list[Any] = []


class ResultReport(BaseModel):
    pass
