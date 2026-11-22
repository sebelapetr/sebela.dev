"""The settings: fake by default, paid only on explicit opt-in, never a default host or port."""

from __future__ import annotations

import pytest

from ai_service.config import ConfigError, Settings
from tests.fakes import CONTROL_TOKEN, ENV, TOKEN


def env(**overrides: str) -> dict[str, str]:
    values = {**ENV, **overrides}
    return {name: value for name, value in values.items() if value != "-"}


def test_the_fake_model_with_the_answer_scenario_is_the_default() -> None:
    settings = Settings.from_env(env())
    assert settings.model == "fake"
    assert settings.fake_scenario == "answer"
    assert settings.max_operations == 4
    assert settings.admission_wait_s == 2.0
    assert settings.allow_paid is False


def test_the_secrets_never_print() -> None:
    settings = Settings.from_env(env())
    assert TOKEN not in repr(settings)
    assert CONTROL_TOKEN not in repr(settings)


@pytest.mark.parametrize(
    "missing", ["AI_SERVICE_HOST", "LLM_AGENT_PORT", "AI_SERVICE_API_URL", "AI_SERVICE_TOKEN"]
)
def test_the_environment_settings_have_no_default(missing: str) -> None:
    with pytest.raises(ConfigError, match=missing):
        Settings.from_env(env(**{missing: "-"}))


def test_a_short_generation_token_is_refused() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_TOKEN"):
        Settings.from_env(env(AI_SERVICE_TOKEN="x" * 31))


def test_a_short_control_token_is_refused() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_CONTROL_TOKEN"):
        Settings.from_env(env(AI_SERVICE_CONTROL_TOKEN="x" * 31))


def test_the_two_tokens_must_differ() -> None:
    with pytest.raises(ConfigError, match="differ"):
        Settings.from_env(env(AI_SERVICE_CONTROL_TOKEN=TOKEN))


def test_the_api_url_must_be_http() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_API_URL"):
        Settings.from_env(env(AI_SERVICE_API_URL="file:///etc/passwd"))


def test_an_unknown_scenario_is_refused() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_FAKE_SCENARIO"):
        Settings.from_env(env(AI_SERVICE_FAKE_SCENARIO="leak"))


@pytest.mark.parametrize(
    ("name", "value"),
    [("AI_SERVICE_MAX_OPERATIONS", "5"), ("AI_SERVICE_ADMISSION_WAIT_S", "2.5")],
)
def test_the_admission_bounds_cannot_be_raised(name: str, value: str) -> None:
    with pytest.raises(ConfigError, match=name):
        Settings.from_env(env(**{name: value}))


def test_anthropic_is_refused_without_the_explicit_flag() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_ALLOW_PAID"):
        Settings.from_env(
            env(
                AI_SERVICE_MODEL="anthropic",
                AI_SERVICE_DAILY_CEILING_USD="0.25",
                ANTHROPIC_API_KEY="fictional-key",
            )
        )


def test_anthropic_is_refused_without_a_daily_ceiling() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_DAILY_CEILING_USD"):
        Settings.from_env(
            env(
                AI_SERVICE_MODEL="anthropic",
                AI_SERVICE_ALLOW_PAID="true",
                ANTHROPIC_API_KEY="fictional-key",
            )
        )


def test_anthropic_is_refused_without_the_provider_key() -> None:
    with pytest.raises(ConfigError, match="secret wrapper"):
        Settings.from_env(
            env(
                AI_SERVICE_MODEL="anthropic",
                AI_SERVICE_ALLOW_PAID="true",
                AI_SERVICE_DAILY_CEILING_USD="0.25",
            )
        )


def test_anthropic_with_the_flag_the_ceiling_and_the_key_is_accepted() -> None:
    settings = Settings.from_env(
        env(
            AI_SERVICE_MODEL="anthropic",
            AI_SERVICE_ALLOW_PAID="true",
            AI_SERVICE_DAILY_CEILING_USD="0.25",
            ANTHROPIC_API_KEY="fictional-key",
        )
    )
    assert settings.model == "anthropic"
    assert settings.daily_ceiling_usd == 0.25
    assert "fictional-key" not in repr(settings)


def test_the_paid_flag_accepts_only_true_or_false() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_ALLOW_PAID"):
        Settings.from_env(env(AI_SERVICE_ALLOW_PAID="yes"))
