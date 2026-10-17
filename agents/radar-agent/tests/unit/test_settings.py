"""All configuration lives in app/settings.py and is documented in .env.example."""

import re
from pathlib import Path

from app import settings

ENV_EXAMPLE = Path(__file__).parents[2] / ".env.example"


def test_every_setting_is_documented_in_env_example():
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", ENV_EXAMPLE.read_text(), re.MULTILINE))
    missing = set(settings.SETTINGS) - documented
    assert not missing, f"add these to .env.example: {sorted(missing)}"


def test_env_example_shows_each_default():
    text = ENV_EXAMPLE.read_text()
    for s in settings.SETTINGS.values():
        assert f"{s.name}={s.default}\n" in text, s.name
