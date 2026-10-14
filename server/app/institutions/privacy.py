"""Keeps personal data out of the profile (aggregates only).

The profile holds categories, never named people or their account, card or ID numbers.
Every free-text field is checked, whether the forms or the setup agent wrote it.
"""

import re
from typing import Any

# Fields that legitimately hold such patterns (who edited, links, dataset names).
EXEMPT = {"website", "edited_by", "edited_at", "dataset", "created_by", "updated_by", "rule_ref", "regulator_id",
          "hazard_id", "figure_id", "route_id", "template_id", "source_id", "catalog_product_id", "code", "lei"}

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("an email address", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
    ("a person's name", re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Sir)\.?\s+[A-Z][a-z]+")),
    ("an IBAN", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    ("a national ID number", re.compile(r"\b\d{9}[VvXx]\b")),
    ("an account, card, ID or phone number", re.compile(r"(?<![\w,.])\+?\d(?:[\s-]?\d){7,}(?![\w,.])")),
]


def find(data: Any, path: str = "") -> list[tuple[str, str]]:
    """(field, what) for every string that looks like personal data."""
    out: list[tuple[str, str]] = []
    if isinstance(data, dict):
        for k, v in data.items():
            if k not in EXEMPT:
                out += find(v, f"{path}.{k}".lstrip("."))
    elif isinstance(data, list):
        for i, v in enumerate(data):
            out += find(v, f"{path}.{i}" if path else str(i))
    elif isinstance(data, str):
        for what, rx in PATTERNS:
            if rx.search(data):
                out.append((path, what))
                break
    return out


def errors(data: Any, section: str, item_id: str | None = None) -> list[dict]:
    return [{"section": section, "id": item_id, "field": f, "code": "personal_data",
             "message": f"looks like {what}; the profile holds categories, never named customers or their numbers"}
            for f, what in find(data)]
