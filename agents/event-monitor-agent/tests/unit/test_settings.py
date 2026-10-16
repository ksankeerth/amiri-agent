"""All configuration lives in app/settings.py and is documented in .env.example."""

import re
from pathlib import Path

from app import settings

ENV_EXAMPLE = Path(__file__).parents[2] / ".env.example"


def test_every_setting_is_documented_in_env_example():
    text = ENV_EXAMPLE.read_text()
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", text, re.MULTILINE))
    missing = set(settings.SETTINGS) - documented
    assert not missing, f"add these to .env.example: {sorted(missing)}"


def test_env_example_shows_each_default():
    text = ENV_EXAMPLE.read_text()
    for s in settings.SETTINGS.values():
        if s.default:
            assert f"{s.name}={s.default}" in text, s.name


def test_environment_overrides_the_default(monkeypatch):
    monkeypatch.delenv("REVIEWER_TIMEOUT_SECONDS", raising=False)
    assert settings.number("REVIEWER_TIMEOUT_SECONDS") == 45.0
    monkeypatch.setenv("REVIEWER_TIMEOUT_SECONDS", "12.5")
    assert settings.number("REVIEWER_TIMEOUT_SECONDS") == 12.5
    monkeypatch.setenv("REVIEWER_TIMEOUT_SECONDS", "   ")  # blank = default
    assert settings.number("REVIEWER_TIMEOUT_SECONDS") == 45.0


def test_lists_paths_and_flags(monkeypatch):
    monkeypatch.setenv("SEARCH_MODELS", "a, b,,a")
    assert settings.names("SEARCH_MODELS") == ["a", "b"]
    monkeypatch.setenv("RUNS_DB_PATH", "data/x.db")
    assert settings.path("RUNS_DB_PATH") == settings.PROJECT / "data" / "x.db"
    monkeypatch.setenv("RUNS_DB_PATH", "/tmp/y.db")
    assert settings.path("RUNS_DB_PATH") == Path("/tmp/y.db")
    monkeypatch.delenv("OTEL_TO_CLOUD", raising=False)
    assert settings.flag("OTEL_TO_CLOUD") is None
    monkeypatch.setenv("OTEL_TO_CLOUD", "true")
    assert settings.flag("OTEL_TO_CLOUD") is True
