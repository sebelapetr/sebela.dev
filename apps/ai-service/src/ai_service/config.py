"""The service's settings, read once from the environment and validated before anything starts.

Nothing about the environment is hard-coded: the host, the port and the API URL always come from
the environment. The model defaults to the fictional `fake` one, which is refused when
`AI_SERVICE_ENVIRONMENT` is `production`; the paid `anthropic` one needs an explicit opt-in, a
daily ceiling and a provider key the secret wrapper provides. The trace export (`langfuse`) is on
only when its base address and both keys are set; with any of them empty it is off, never an error.
`AI_SERVICE_TRACE_DETECTOR_DIR` optionally names a pinned local detector folder for it;
a folder that is not an accepted detector keeps the export metadata-only.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, model_validator

ModelMode = Literal["fake", "anthropic"]
FakeScenario = Literal["answer", "slow", "refuse", "fail"]

#: The shortest bearer accepted for the generation route and the API control routes.
MIN_TOKEN_CHARS = 32

#: The environment of the production server (`AI_SERVICE_ENVIRONMENT`), where only the paid model
#: may run.
PRODUCTION = "production"


_LANGFUSE_ENVIRONMENT = re.compile(r"(?!langfuse)[a-z0-9_-]{1,40}")


class ConfigError(Exception):
    """The environment does not describe a valid service; the message names the setting."""


class Langfuse(BaseModel):
    """Where the metadata-only traces go (`AI_SERVICE_LANGFUSE_*`); the secret key never prints."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    base_url: str = Field(min_length=1)
    public_key: str = Field(min_length=1)
    secret_key: SecretStr
    #: Langfuse's environment of every trace: lowercase, at most 40 characters.
    environment: str = "development"

    @model_validator(mode="after")
    def _valid(self) -> Self:
        if urlsplit(self.base_url).scheme not in ("http", "https"):
            raise ValueError("AI_SERVICE_LANGFUSE_BASE_URL must be an http or https URL")
        if not _LANGFUSE_ENVIRONMENT.fullmatch(self.environment):
            raise ValueError(
                "AI_SERVICE_LANGFUSE_ENVIRONMENT must be at most 40 lowercase letters, digits, "
                "`-` or `_` and not start with `langfuse`"
            )
        if not self.secret_key.get_secret_value():
            raise ValueError("AI_SERVICE_LANGFUSE_SECRET_KEY is empty")
        object.__setattr__(self, "base_url", self.base_url.rstrip("/"))
        return self


class Settings(BaseModel):
    """The validated configuration. Secrets are `SecretStr` so they never print."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    host: str = Field(min_length=1)
    port: int = Field(ge=1, le=65535)
    #: The API base: public content reads and the internal control routes.
    api_url: str = Field(min_length=1)
    #: The bearer the API presents on `POST /internal/v1/generations`.
    token: SecretStr
    #: The bearer this service presents on the API's control routes (`API_AI_CONTROL_TOKEN`).
    control_token: SecretStr
    model: ModelMode = "fake"
    fake_scenario: FakeScenario = "answer"
    #: Test-only channels of the fictional model, absolute paths refused in paid mode: the file
    #: that receives one JSON line per model call, and the file whose existence opens the `slow`
    #: scenario's gate.
    fake_calls_file: Path | None = None
    fake_gate_file: Path | None = None
    #: The explicit opt-in to paid provider calls (`anthropic` mode only).
    allow_paid: bool = False
    #: The service's own daily spending ceiling in paid mode (USD per UTC day, this process;
    #: at most USD 0.25).
    daily_ceiling_usd: float | None = Field(default=None, gt=0, le=0.25)
    #: Set only when the provider key is present in the environment; the key itself is not kept.
    provider_key_present: bool = False
    #: The environment this deployment runs as (`AI_SERVICE_ENVIRONMENT`, which the Compose files
    #: take from the API's `STORAGE_ENVIRONMENT`); a label only. The fictional model is refused in
    #: `production`, so a missing provider key never looks like a working chat.
    environment: str = ""
    max_operations: int = Field(default=4, ge=1, le=4)
    admission_wait_s: float = Field(default=2.0, gt=0, le=2.0)
    #: How long a shutdown waits for running generations before it interrupts them.
    shutdown_grace_s: float = Field(default=25.0, gt=0, le=65.0)
    #: The trace export; None (any `AI_SERVICE_LANGFUSE_*` key unset) exports nothing.
    langfuse: Langfuse | None = None
    #: A pinned local detector folder for the trace export (absolute); None means no detector.
    trace_detector_dir: Path | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if urlsplit(self.api_url).scheme not in ("http", "https"):
            raise ValueError("AI_SERVICE_API_URL must be an http or https URL")
        for name, secret in (
            ("AI_SERVICE_TOKEN", self.token),
            ("AI_SERVICE_CONTROL_TOKEN", self.control_token),
        ):
            if len(secret.get_secret_value()) < MIN_TOKEN_CHARS:
                raise ValueError(f"{name} must have at least {MIN_TOKEN_CHARS} characters")
        if self.token.get_secret_value() == self.control_token.get_secret_value():
            raise ValueError("AI_SERVICE_TOKEN and AI_SERVICE_CONTROL_TOKEN must differ")
        for name, path in (
            ("AI_SERVICE_FAKE_CALLS_FILE", self.fake_calls_file),
            ("AI_SERVICE_FAKE_GATE_FILE", self.fake_gate_file),
        ):
            if path is None:
                continue
            if not path.is_absolute():
                raise ValueError(f"{name} must be an absolute path")
            if self.model != "fake":
                raise ValueError(f"{name} is for the fictional model only")
        if self.trace_detector_dir is not None and not self.trace_detector_dir.is_absolute():
            raise ValueError("AI_SERVICE_TRACE_DETECTOR_DIR must be an absolute path")
        if self.model == "fake" and self.environment.strip().lower() == PRODUCTION:
            raise ValueError(
                "the fictional model is refused when AI_SERVICE_ENVIRONMENT is production; "
                "set AI_SERVICE_MODEL=anthropic with its opt-in, ceiling and provider key"
            )
        if self.model == "anthropic":
            if not self.allow_paid:
                raise ValueError("AI_SERVICE_MODEL=anthropic needs AI_SERVICE_ALLOW_PAID=true")
            if self.daily_ceiling_usd is None:
                raise ValueError("AI_SERVICE_MODEL=anthropic needs AI_SERVICE_DAILY_CEILING_USD")
            if not self.provider_key_present:
                raise ValueError(
                    "AI_SERVICE_MODEL=anthropic needs the provider key from the secret wrapper"
                )
        return self

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """The settings `env` describes; `ConfigError` names what is missing or invalid."""
        raw: dict[str, object] = {}
        names = {
            "host": "AI_SERVICE_HOST",
            "port": "LLM_AGENT_PORT",
            "api_url": "AI_SERVICE_API_URL",
            "token": "AI_SERVICE_TOKEN",
            "control_token": "AI_SERVICE_CONTROL_TOKEN",
            "model": "AI_SERVICE_MODEL",
            "fake_scenario": "AI_SERVICE_FAKE_SCENARIO",
            "fake_calls_file": "AI_SERVICE_FAKE_CALLS_FILE",
            "fake_gate_file": "AI_SERVICE_FAKE_GATE_FILE",
            "allow_paid": "AI_SERVICE_ALLOW_PAID",
            "daily_ceiling_usd": "AI_SERVICE_DAILY_CEILING_USD",
            "max_operations": "AI_SERVICE_MAX_OPERATIONS",
            "admission_wait_s": "AI_SERVICE_ADMISSION_WAIT_S",
            "shutdown_grace_s": "AI_SERVICE_SHUTDOWN_GRACE_S",
            "trace_detector_dir": "AI_SERVICE_TRACE_DETECTOR_DIR",
            "environment": "AI_SERVICE_ENVIRONMENT",
        }
        required = ("host", "port", "api_url", "token", "control_token")
        for field, name in names.items():
            value = env.get(name, "").strip()
            if value:
                raw[field] = value
            elif field in required:
                raise ConfigError(f"{name} is not set")
        if raw.get("allow_paid") not in (None, "true", "false"):
            raise ConfigError("AI_SERVICE_ALLOW_PAID must be true or false")
        raw["provider_key_present"] = bool(env.get("ANTHROPIC_API_KEY", "").strip())
        try:
            raw["langfuse"] = _langfuse(env)
            return cls.model_validate(raw)
        except ValidationError as error:
            first = error.errors()[0]
            location = ".".join(str(part) for part in first["loc"])
            setting = names.get(location, location or "the configuration")
            raise ConfigError(f"{setting}: {first['msg']}") from None


def _langfuse(env: Mapping[str, str]) -> Langfuse | None:
    """The trace export `env` describes, or None unless its URL and both keys are all set."""
    base_url = env.get("AI_SERVICE_LANGFUSE_BASE_URL", "").strip()
    public_key = env.get("AI_SERVICE_LANGFUSE_PUBLIC_KEY", "").strip()
    secret_key = env.get("AI_SERVICE_LANGFUSE_SECRET_KEY", "").strip()
    if not (base_url and public_key and secret_key):
        return None
    values = {"base_url": base_url, "public_key": public_key, "secret_key": secret_key}
    environment = env.get("AI_SERVICE_LANGFUSE_ENVIRONMENT", "").strip()
    if environment:
        values["environment"] = environment
    return Langfuse.model_validate(values)
