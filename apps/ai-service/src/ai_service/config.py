"""The service's settings, read once from the environment and validated before anything starts.

Nothing about the environment is hard-coded: the host, the port and the API URL always come from
the environment. The model defaults to the fictional `fake` one; the paid `anthropic` one needs an
explicit opt-in, a daily ceiling and a provider key the secret wrapper provides.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

ModelMode = Literal["fake", "anthropic"]
FakeScenario = Literal["answer", "slow", "refuse", "fail"]

#: The shortest bearer accepted for the generation route and the API control routes.
MIN_TOKEN_CHARS = 32


class ConfigError(Exception):
    """The environment does not describe a valid service; the message names the setting."""


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
    #: The explicit opt-in to paid provider calls (`anthropic` mode only).
    allow_paid: bool = False
    #: The service's own daily spending ceiling in paid mode (USD per UTC day, this process).
    daily_ceiling_usd: float | None = Field(default=None, gt=0)
    #: Set only when the provider key is present in the environment; the key itself is not kept.
    provider_key_present: bool = False
    max_operations: int = Field(default=4, ge=1, le=4)
    admission_wait_s: float = Field(default=2.0, gt=0, le=2.0)
    #: How long a shutdown waits for running generations before it interrupts them.
    shutdown_grace_s: float = Field(default=25.0, gt=0, le=65.0)

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
        raise NotImplementedError(sorted(env), cls)
