"""openapi.yaml and app/contract.py describe the same API, and the rules hold."""

import copy
from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel, ValidationError

from app import contract, vocab

SPEC = yaml.safe_load((Path(__file__).parents[2] / "openapi.yaml").read_text())
SCHEMAS = SPEC["components"]["schemas"]
REQUEST = SPEC["paths"]["/investigations"]["post"]["requestBody"]["content"][
    "application/json"
]["example"]
STATUS_EXAMPLES = SPEC["paths"]["/investigations/{run_id}"]["get"]["responses"]["200"][
    "content"
]["application/json"]["examples"]

# schema name -> model, for every object schema the API exposes
MODELS: dict[str, type[BaseModel]] = {
    "InvestigationRequest": contract.InvestigationRequest,
    "Institution": contract.Institution,
    "Segment": contract.Segment,
    "Flow": contract.Flow,
    "Extend": contract.Extend,
    "FootprintCountry": contract.FootprintCountry,
    "PlaceInfo": contract.PlaceInfo,
    "Finding": contract.Finding,
    "FindingEvidence": contract.FindingEvidence,
    "SignalRecord": contract.SignalRecord,
    "Headline": contract.Headline,
    "WebPage": contract.WebPage,
    "Period": contract.Period,
    "Product": contract.Product,
    "Untracked": contract.Untracked,
    "Limits": contract.Limits,
    "InvestigationStatus": contract.InvestigationStatus,
    "InvestigationResult": contract.InvestigationResult,
    "ThemeTag": contract.ThemeTag,
    "Size": contract.Size,
    "Classification": contract.Classification,
    "Event": contract.Event,
    "OutOfScope": contract.OutOfScope,
    "Screening": contract.Screening,
    "Hypothesis": contract.Hypothesis,
    "SegmentFilter": contract.SegmentFilter,
    "Expectation": contract.Expectation,
    "BusinessDates": contract.BusinessDates,
    "Baseline": contract.Baseline,
    "Threshold": contract.Threshold,
    "MaskRule": contract.MaskRule,
    "Amount": contract.Amount,
    "ValidationTask": contract.ValidationTask,
    "ContextItem": contract.ContextItem,
    "ToolCall": contract.ToolCall,
    "Usage": contract.Usage,
    "Error": contract.Error,
}


def field_names(model: type[BaseModel]) -> set[str]:
    return {f.alias or name for name, f in model.model_fields.items()}


def required_names(model: type[BaseModel]) -> set[str]:
    return {
        f.alias or name for name, f in model.model_fields.items() if f.is_required()
    }


@pytest.mark.parametrize("name", sorted(MODELS))
def test_schema_and_model_have_the_same_fields(name):
    schema, model = SCHEMAS[name], MODELS[name]
    assert set(schema.get("properties", {})) == field_names(model), name
    assert set(schema.get("required", [])) == required_names(model), name


def test_every_object_schema_has_a_model():
    objects = {
        n
        for n, s in SCHEMAS.items()
        if s.get("type") == "object" and n != "ValidationError"
    }
    assert objects == set(MODELS)


def test_enums_match_the_vocabulary():
    assert SCHEMAS["Theme"]["enum"] == list(vocab.values(vocab.Theme))
    assert SCHEMAS["ProductType"]["enum"] == list(vocab.values(vocab.ProductType))
    assert SCHEMAS["ToolCall"]["properties"]["tool"]["enum"] == list(
        vocab.values(contract.ToolName)
    )
    vocab.check_tables()


# ---------------------------------------------------------------- examples


def test_request_example_is_valid():
    req = contract.InvestigationRequest.model_validate(REQUEST)
    assert req.limits.max_tasks == 15
    assert {pid: t for pid, (_, t) in req.tracked().items()} == {
        "migrant-savings": "savings",
        "term-deposits": "savings",
        "pawning": "pawning",
        "personal-loans": "retail_loan",
        "sme-loans": "business_loan",
        "corporate-loans": "business_loan",
        "trade-finance": "trade_finance",
    }
    assert (
        req.findings[0].themes[0].direction,
        req.findings[0].themes[0].currency,
    ) == ("weaker", "LKR")
    assert req.institution.zone().key == "Asia/Colombo"


@pytest.mark.parametrize("name", sorted(STATUS_EXAMPLES))
def test_status_examples_are_valid(name):
    contract.InvestigationStatus.model_validate(STATUS_EXAMPLES[name]["value"])


def test_task_dates_round_trip_with_their_json_names():
    status = contract.InvestigationStatus.model_validate(
        STATUS_EXAMPLES["completed"]["value"]
    )
    task = status.result.tasks[0]
    assert str(task.watch.from_) == "2026-10-06"
    dumped = task.model_dump(mode="json", by_alias=True)
    assert dumped["watch"] == {"from": "2026-10-06", "until": "2026-11-18"}
    assert (task.phase, task.currency_basis, task.vintage_rule) == (
        "effect",
        "original",
        "same_age",
    )


# ------------------------------------------------------------ request rules


def request(**changes) -> dict:
    body = copy.deepcopy(REQUEST)
    body.update(changes)
    return body


def finding(**changes) -> dict:
    return {**copy.deepcopy(REQUEST["findings"][0]), **changes}


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (request(findings=[finding(), finding()]), "finding_id listed more than once"),
        (
            request(products=[REQUEST["products"][0], REQUEST["products"][0]]),
            "product_id listed more than once",
        ),
        (request(products=[]), "at least 1"),
        (
            request(
                findings=[
                    finding(
                        themes=[
                            {
                                "theme": "markets",
                                "direction": "bonds_down",
                                "implied": True,
                            }
                        ]
                    )
                ]
            ),
            "implied themes are added by the agent",
        ),
        (request(findings=[finding(source="feed")]), "Input should be"),
        (
            request(
                institution={**REQUEST["institution"], "time_zone": "Asia/Atlantis"}
            ),
            "unknown time zone",
        ),
        (request(findings=[finding(evidence={})]), "has no evidence"),
        (request(findings=[]), "at least 1"),
    ],
)
def test_inconsistent_requests_are_rejected(body, message):
    with pytest.raises(ValidationError) as e:
        contract.InvestigationRequest.model_validate(body)
    assert message in str(e.value)


def news(**changes) -> dict:
    """A monitor's news match: no themes, the agent classifies it."""
    return finding(
        finding_id="f-mon-1",
        source="monitor",
        source_ref={"monitor_id": "mon-fx"},
        kind="news_match",
        themes=[],
        places=[],
        title="Rupee falls past 333",
        explanation="As reported.",
        evidence={
            "headlines": [
                {
                    "title": "Rupee falls past 333 as importer dollar demand surges",
                    "published_at": "2026-10-06T08:06:00Z",
                    "outlet": "Daily Mirror",
                }
            ]
        },
        **changes,
    )


def test_times_without_a_zone_are_rejected():
    f = news()
    f["evidence"]["headlines"][0]["published_at"] = "2026-10-06T08:06:00"
    with pytest.raises(ValidationError, match="timezone"):
        contract.InvestigationRequest.model_validate(request(findings=[f]))


def test_times_are_kept_in_utc():
    f = news()
    f["evidence"]["headlines"][0]["published_at"] = "2026-10-06T13:36:00+05:30"
    req = contract.InvestigationRequest.model_validate(request(findings=[f]))
    published = req.findings[0].evidence.headlines[0].published_at
    assert published.isoformat() == "2026-10-06T08:06:00+00:00"


def test_period_and_effective_date():
    f = finding(
        effective_from="2027-04-01", period={"start": "2026-09-01", "end": "2026-09-30"}
    )
    contract.InvestigationRequest.model_validate(request(findings=[f]))
    bad = finding(period={"start": "2026-09-30", "end": "2026-09-01"})
    with pytest.raises(ValidationError, match="must not be before"):
        contract.InvestigationRequest.model_validate(request(findings=[bad]))


# ----------------------------------------------------------- result rules


@pytest.mark.parametrize(
    ("tag", "ok"),
    [
        ({"theme": "fx", "direction": "weaker", "currency": "INR"}, True),
        ({"theme": "fx", "direction": "home_weaker"}, False),
        ({"theme": "rates", "direction": "up", "currency": "LKR"}, False),
        ({"theme": "fx", "direction": "rupee_weaker"}, False),
        ({"theme": "fx", "direction": "up"}, False),
        ({"theme": "trust", "direction": "rival"}, True),
        ({"theme": "prices", "direction": "up", "item": "fuel"}, True),
        ({"theme": "commodities", "direction": "up", "item": "gold"}, True),
        ({"theme": "commodities", "direction": "up", "item": "fuel"}, False),
        ({"theme": "gold", "direction": "up"}, False),
        ({"theme": "competitor", "direction": "cheaper"}, True),
        ({"theme": "sector", "direction": "shock", "sector": "tourism"}, True),
    ],
)
def test_theme_and_direction_must_pair(tag, ok):
    if ok:
        contract.ThemeTag.model_validate(tag)
    else:
        with pytest.raises(ValidationError):
            contract.ThemeTag.model_validate(tag)


def completed_result() -> dict:
    return copy.deepcopy(STATUS_EXAMPLES["completed"]["value"]["result"])


def test_screening_angle_must_belong_to_the_product_type():
    r = completed_result()
    r["screening"][0]["angle"] = "collateral"  # a pawning angle
    with pytest.raises(ValidationError, match="not an angle of business_loan"):
        contract.InvestigationResult.model_validate(r)


def test_kept_screening_names_its_products():
    r = completed_result()
    r["screening"][0]["product_ids"] = []
    with pytest.raises(ValidationError, match="names its products"):
        contract.InvestigationResult.model_validate(r)


def test_baseline_must_end_before_the_watch():
    r = completed_result()
    r["tasks"][0]["baseline"] = {
        "from": "2026-09-01",
        "until": "2026-10-10",
        "basis": "aligned_prior_spans",
    }
    with pytest.raises(ValidationError, match="baseline must end before"):
        contract.InvestigationResult.model_validate(r)


def test_tasks_and_hypotheses_must_reference_known_ids():
    r = completed_result()
    r["tasks"][0]["hypothesis_id"] = "h-404"
    with pytest.raises(ValidationError, match="unknown hypothesis"):
        contract.InvestigationResult.model_validate(r)
    r = completed_result()
    r["hypotheses"][0]["event_id"] = "e-404"
    with pytest.raises(ValidationError, match="unknown event"):
        contract.InvestigationResult.model_validate(r)


@pytest.mark.parametrize(
    ("status", "fields", "ok"),
    [
        ("running", {"started_at": "2026-10-06T09:00:03Z"}, True),
        ("running", {"error": "x", "finished_at": "2026-10-06T09:00:09Z"}, False),
        ("failed", {"finished_at": "2026-10-06T09:00:09Z"}, False),
        (
            "completed",
            {
                "started_at": "2026-10-06T09:00:03Z",
                "finished_at": "2026-10-06T09:01:10Z",
            },
            False,
        ),
    ],
)
def test_status_fields_match_the_status(status, fields, ok):
    body = {
        "run_id": "r",
        "status": status,
        "created_at": "2026-10-06T09:00:02Z",
        **fields,
    }
    if ok:
        contract.InvestigationStatus.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            contract.InvestigationStatus.model_validate(body)


def test_every_setting_is_documented_in_env_example():
    import re

    from app import settings

    text = (Path(__file__).parents[2] / ".env.example").read_text()
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", text, re.MULTILINE))
    assert set(settings.SETTINGS) <= documented
