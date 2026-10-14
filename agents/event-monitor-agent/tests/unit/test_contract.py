"""openapi.yaml is generated from the models and current; the examples and the request rules hold."""

import copy
import importlib.util
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app import contract as c
from app import examples

ROOT = Path(__file__).parents[2]
_spec = importlib.util.spec_from_file_location(
    "write_openapi", ROOT / "scripts" / "write_openapi.py"
)
write_openapi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(write_openapi)


def test_openapi_yaml_is_current():
    assert yaml.safe_load((ROOT / "openapi.yaml").read_text()) == yaml.safe_load(
        write_openapi.text()
    ), "openapi.yaml is out of date: uv run python scripts/write_openapi.py"


def test_examples_are_valid():
    c.CheckRequest.model_validate(examples.REQUEST)
    for status in (examples.COMPLETED, examples.RUNNING, examples.FAILED):
        c.CheckStatus.model_validate(status)


def body(**changes) -> dict:
    return {**copy.deepcopy(examples.REQUEST), **changes}


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"web_search": None}, "needs web_search, or provided_news"),
        ({"provided_news": []}, "reads provided_news only"),
        (
            {
                "window": {
                    "since": "2026-10-12T10:00:00Z",
                    "until": "2026-10-12T09:00:00Z",
                }
            },
            "until must be after",
        ),
        (
            {
                "web_search": None,
                "provided_news": [
                    {"id": "n1", "title": "a", "published_at": "2026-10-12T09:10:00Z"},
                    {"id": "n1", "title": "b", "published_at": "2026-10-12T09:20:00Z"},
                ],
            },
            "listed more than once",
        ),
    ],
)
def test_request_rules(changes, message):
    with pytest.raises(ValidationError, match=message):
        c.CheckRequest.model_validate(body(**changes))


def test_exposures_must_be_the_profiles():
    b = body()
    b["monitor"]["spec"]["private"]["exposure"].append(
        {"id": "product:no-such-product", "how_it_reaches_us": ""}
    )
    with pytest.raises(ValidationError, match="product:no-such-product"):
        c.CheckRequest.model_validate(b)


@pytest.mark.parametrize(
    ("field", "value"), [("places", ["Gulf states"]), ("languages", ["english"])]
)
def test_places_and_languages_are_codes(field, value):
    b = body()
    b["monitor"]["spec"]["public"][field] = value
    with pytest.raises(ValidationError):
        c.CheckRequest.model_validate(b)


def test_any_language_and_gazetteer_places():
    b = body()
    b["monitor"]["spec"]["public"]["languages"] = ["tl", "id", "vi"]
    b["monitor"]["spec"]["public"]["places"] = ["PH-08", "chk:hormuz", "city:jaffna"]
    c.CheckRequest.model_validate(b)


def test_example_headlines_point_at_real_lines():
    b = body()
    b["monitor"]["spec"]["public"]["example_headlines"]["match"][0]["line"] = 9
    with pytest.raises(ValidationError, match="only 3"):
        c.CheckRequest.model_validate(b)


def test_status_fields_match_the_status():
    with pytest.raises(ValidationError):
        c.CheckStatus.model_validate({**examples.RUNNING, "error": "x"})
    with pytest.raises(ValidationError):
        c.CheckStatus.model_validate({**examples.FAILED, "error": None})
