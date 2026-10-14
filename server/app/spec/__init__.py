"""The Metrics Spec the server works from: product categories and types (bank or
insurer), dimensions with their values, themes, and each category's metrics with
their breakdowns and validation rules. A snapshot of the Metrics Spec source
(metrics-spec-v1.0.yaml), kept here so the image is self-contained;
`uv run amiri spec-sync` refreshes it when the source file is at hand."""

import json
from functools import cache
from pathlib import Path

SNAPSHOT = Path(__file__).parent / "metrics_spec_v1.json"
SOURCE = Path(__file__).resolve().parents[3] / "design" / "metrics-spec-v1.0.yaml"
SEGMENT_DIMENSIONS = ("segment", "age_band", "size_band", "sector", "sector_l2", "employer_sector",
                      "region_l1", "region_l2", "channel", "sales_channel", "corridor", "currency")


@cache
def spec() -> dict:
    return json.loads(SNAPSHOT.read_text())


def categories(institution_type: str | None = None) -> list[dict]:
    cats = spec()["categories"]
    return [c for c in cats if institution_type is None or c["institution"] == institution_type]


def category(cat_id: str) -> dict | None:
    return next((c for c in spec()["categories"] if c["id"] == cat_id), None)


def dimension(key: str) -> dict | None:
    """A dimension usable for customer groups (segments)."""
    return spec()["dimensions"].get(key) if key in SEGMENT_DIMENSIONS else None


def any_dimension(key: str) -> dict | None:
    return spec()["dimensions"].get(key)


METRIC_FIELDS = ("key", "name", "question", "kind", "unit", "currency_rule", "grain", "day_basis", "max_lag_days",
                 "history_months", "breakdowns", "adverse", "applies_to", "scope", "tier", "validation")


def _values(v) -> list[str] | None:
    """A dimension's fixed values: a list, or the union of a dict of lists (claim_type by line)."""
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        return list(dict.fromkeys(x for vs in v.values() if isinstance(vs, list) for x in vs))
    return None


def metrics(category_id: str) -> list[dict]:
    """The category's metrics with their breakdowns and validation rules."""
    return spec().get("metrics", {}).get(category_id, [])


def sync(source: Path = SOURCE) -> dict:
    """Rewrites the snapshot from the spec's YAML."""
    import yaml

    d = yaml.safe_load(source.read_text())
    out = {
        "spec_version": d["spec_version"],
        "categories": [
            {"id": c["id"], "institution": c["institution"], "name": c["name"],
             "product_types": [{"id": p["id"], "typical_products": p.get("typical_products"),
                                "islamic_variant": p.get("islamic_variant")} for p in c["product_types"]]}
            for c in d["categories"]
        ],
        "dimensions": {
            k: {"values": _values(v.get("values")),
                "format": v["values"] if isinstance(v.get("values"), str) else None,
                "description": (v.get("description") or "")[:400]}
            for k, v in d["dimensions"].items()
        },
        "metrics": {
            c["id"]: [{k: m.get(k) for k in METRIC_FIELDS} for m in c.get("metrics", [])]
            for c in d["categories"]
        },
        "themes": d["vocabularies"]["themes"],
    }
    SNAPSHOT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    spec.cache_clear()
    return out
