"""The settings: fake by default, paid only on explicit opt-in, never a default host or port."""

from __future__ import annotations

from pathlib import Path

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


def test_the_fake_test_channels_are_read_as_absolute_paths(tmp_path: Path) -> None:
    calls = tmp_path / "calls.jsonl"
    gate = tmp_path / "gate"
    settings = Settings.from_env(
        env(AI_SERVICE_FAKE_CALLS_FILE=str(calls), AI_SERVICE_FAKE_GATE_FILE=str(gate))
    )
    assert settings.fake_calls_file == calls
    assert settings.fake_gate_file == gate


def test_the_fake_test_channels_are_off_by_default() -> None:
    settings = Settings.from_env(env())
    assert settings.fake_calls_file is None
    assert settings.fake_gate_file is None


@pytest.mark.parametrize("name", ["AI_SERVICE_FAKE_CALLS_FILE", "AI_SERVICE_FAKE_GATE_FILE"])
def test_a_fake_test_channel_must_be_an_absolute_path(name: str) -> None:
    with pytest.raises(ConfigError, match=name):
        Settings.from_env(env(**{name: "relative/calls.jsonl"}))


@pytest.mark.parametrize("name", ["AI_SERVICE_FAKE_CALLS_FILE", "AI_SERVICE_FAKE_GATE_FILE"])
def test_a_fake_test_channel_is_refused_with_the_paid_model(name: str, tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match=name):
        Settings.from_env(
            env(
                AI_SERVICE_MODEL="anthropic",
                AI_SERVICE_ALLOW_PAID="true",
                AI_SERVICE_DAILY_CEILING_USD="0.25",
                ANTHROPIC_API_KEY="fictional-key",
                **{name: str(tmp_path / "channel")},
            )
        )


LANGFUSE = {
    "AI_SERVICE_LANGFUSE_BASE_URL": "https://langfuse.example.test/",
    "AI_SERVICE_LANGFUSE_PUBLIC_KEY": "pk-lf-fictional-0000",
    "AI_SERVICE_LANGFUSE_SECRET_KEY": "sk-lf-fictional-secret-0000",
}


def test_the_trace_export_is_off_by_default() -> None:
    assert Settings.from_env(env()).langfuse is None


@pytest.mark.parametrize("missing", sorted(LANGFUSE))
def test_the_trace_export_is_off_unless_every_langfuse_setting_is_set(missing: str) -> None:
    assert Settings.from_env(env(**{**LANGFUSE, missing: "-"})).langfuse is None


def test_the_trace_export_reads_the_langfuse_settings_and_never_prints_the_key() -> None:
    settings = Settings.from_env(env(**LANGFUSE))
    assert settings.langfuse is not None
    assert settings.langfuse.base_url == "https://langfuse.example.test"
    assert settings.langfuse.public_key == "pk-lf-fictional-0000"
    assert settings.langfuse.secret_key.get_secret_value() == "sk-lf-fictional-secret-0000"
    assert settings.langfuse.environment == "development"
    assert "sk-lf-fictional-secret-0000" not in repr(settings)


def test_the_langfuse_environment_is_configurable() -> None:
    settings = Settings.from_env(env(**LANGFUSE, AI_SERVICE_LANGFUSE_ENVIRONMENT="production"))
    assert settings.langfuse is not None
    assert settings.langfuse.environment == "production"


@pytest.mark.parametrize("value", ["Production", "langfuse-x", "a b", "x" * 41])
def test_an_invalid_langfuse_environment_is_refused(value: str) -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_LANGFUSE_ENVIRONMENT"):
        Settings.from_env(env(**LANGFUSE, AI_SERVICE_LANGFUSE_ENVIRONMENT=value))


def test_the_langfuse_base_url_must_be_http() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_LANGFUSE_BASE_URL"):
        Settings.from_env(env(**{**LANGFUSE, "AI_SERVICE_LANGFUSE_BASE_URL": "ftp://x.test"}))


def test_the_trace_detector_folder_is_off_by_default() -> None:
    assert Settings.from_env(env(**LANGFUSE)).trace_detector_dir is None


def test_the_trace_detector_folder_is_read_as_an_absolute_path(tmp_path: Path) -> None:
    settings = Settings.from_env(env(**LANGFUSE, AI_SERVICE_TRACE_DETECTOR_DIR=str(tmp_path)))
    assert settings.trace_detector_dir == tmp_path


def test_the_trace_detector_folder_must_be_absolute() -> None:
    with pytest.raises(ConfigError, match="AI_SERVICE_TRACE_DETECTOR_DIR"):
        Settings.from_env(env(**LANGFUSE, AI_SERVICE_TRACE_DETECTOR_DIR="models/ner"))
