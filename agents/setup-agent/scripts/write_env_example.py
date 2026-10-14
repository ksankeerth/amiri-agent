"""Writes .env.example from app/settings.py (every setting, commented, with its default).

    uv run python scripts/write_env_example.py
"""

import textwrap

from app import settings

HEAD = """# Configuration for the setup agent. Copy to .env and change what you need.
# Every setting below is optional: uncomment a line to change it. The value shown
# is the default (app/settings.py). Real environment variables win over .env.

# ---- Credentials (pick one) ----------------------------------------------------

# Gemini API via Google AI Studio:
# GEMINI_API_KEY=your-api-key-here

# Or Vertex AI (the default for deployment):
# GOOGLE_GENAI_USE_ENTERPRISE=true
# GOOGLE_CLOUD_PROJECT=your-gcp-project-id
# GOOGLE_CLOUD_LOCATION=global

# ---- Settings ------------------------------------------------------------------
"""


def main() -> None:
    out = [HEAD]
    for s in settings.SETTINGS.values():
        out.append("\n".join(f"# {line}" for line in textwrap.wrap(s.help, 86)))
        out.append(f"# {s.name}={s.default}\n")
    (settings.PROJECT / ".env.example").write_text("\n".join(out))
    print("wrote .env.example")


if __name__ == "__main__":
    main()
